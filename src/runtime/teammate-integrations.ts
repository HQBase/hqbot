import {
  createCodemodeRuntime,
  DynamicWorkerExecutor,
  type McpConnectionLike,
  type ProxyToolOutput
} from "@cloudflare/codemode";
import type { Tool } from "ai";
import type { IntegrationApproval } from "../domain/actions";
import type { PermissionDecision } from "../domain/permissions";
import type { ActionHistory } from "./action-history";

import type { TeammateExternalEffects } from "./external-effects";
import {
  integrationApprovalStatus,
  rejectPendingIntegrationActions
} from "./integration-lifecycle";
import { TeammateMcpConnector } from "./integrations";
import {
  cleanBearerToken,
  cleanConnectionName,
  cleanConnectionUrl,
  integrationOutcomeText,
  mcpConnectorName,
  type TeammateConnection
} from "./mcp";
import { safeTaskId } from "./turn";

interface ReadyServer {
  connection: McpConnectionLike;
  id: string;
  name: string;
}

interface TeammateIntegrationsOptions {
  addAssistantMessage: (id: string, text: string) => Promise<void>;
  addServer: (
    name: string,
    url: string,
    token?: string
  ) => Promise<{ authUrl?: string; id: string; state: string }>;
  history: ActionHistory;
  continueTurn: (id: string, text: string) => Promise<void>;
  scheduleRecovery: () => Promise<void>;
  botId: string;
  ctx: Parameters<typeof createCodemodeRuntime>[0]["ctx"];
  effects: TeammateExternalEffects;
  env: Env;
  isActive: () => Promise<boolean>;
  authorizeServer?: (url: string) => Promise<void>;
  loader: ConstructorParameters<typeof DynamicWorkerExecutor>[0]["loader"];
  list: () => TeammateConnection[];
  markEffectUncertain: () => Promise<void>;
  markInteraction: (summary: string, status: "idle" | "needs_approval") => Promise<void>;
  readyServers: () => ReadyServer[];
  removeServer: (id: string) => Promise<void>;
  serverExists: (id: string) => boolean;
  permission?: (connector: string, action: string, input: unknown) => PermissionDecision;
}

export class TeammateIntegrations {
  private reviewingRules = false;
  constructor(private readonly options: TeammateIntegrationsOptions) {}

  list(): TeammateConnection[] {
    return this.options.list();
  }

  hasReadyConnection(): boolean {
    return this.options.readyServers().length > 0;
  }

  tool(): Tool {
    const tool = this.runtime().tool();
    return {
      ...tool,
      description: `${tool.description}\n\nReturn the result explicitly from every script so you can read it. Start with: return await codemode.search("short intent phrase"); Then return await codemode.describe(matches.results[0].path) using the actual path from the previous result. A variable assignment alone returns no value; it does not mean the search found no tools. Connected-service tool calls need owner approval unless an explicit owner rule permits that action and input. Local discovery with codemode.search and codemode.describe does not need approval.`
    };
  }

  async connect(input: { name: string; url: string; token?: string }): Promise<TeammateConnection> {
    if (!(await this.options.isActive())) {
      throw new Error("Restore this teammate before you add a connection");
    }
    const url = cleanConnectionUrl(input.url);
    await this.options.authorizeServer?.(url);
    if (this.list().some((connection) => connection.url === url))
      throw new Error(
        "This server is already connected. Remove it first to replace its credentials."
      );
    const result = await this.options.addServer(
      cleanConnectionName(input.name),
      url,
      cleanBearerToken(input.token)
    );
    const connection = this.list().find((item) => item.id === result.id);
    if (!connection) throw new Error("The connection state is not available");
    return result.state === "authenticating"
      ? { ...connection, authUrl: result.authUrl ?? null }
      : connection;
  }

  async disconnect(id: string): Promise<void> {
    if (!this.options.serverExists(id)) throw new Error("Connection not found");
    const runtime = this.runtime();
    const rejected = await rejectPendingIntegrationActions(runtime, mcpConnectorName(id));
    await this.options.removeServer(id);
    if (rejected > 0) {
      await this.options.markInteraction(
        "Connection removed",
        await integrationApprovalStatus(runtime)
      );
    }
  }

  async pending(): Promise<IntegrationApproval[]> {
    if (!this.reviewingRules && this.options.permission && (await this.options.isActive())) {
      this.reviewingRules = true;
      try {
        for (let count = 0; count < 16; count++) {
          const action = (await this.runtime().pending()).find(
            (item) => this.options.permission?.(item.connector, item.method, item.args) !== "review"
          );
          if (!action) break;
          const decision = this.options.permission(action.connector, action.method, action.args);
          const saved = await this.options.history.pending(action);
          await this.options.scheduleRecovery();
          if (decision === "allow") {
            if (
              !this.options.history.decide(
                action.executionId,
                action.seq,
                saved.inputHash,
                "approved"
              )
            )
              break;
            await this.applyApproval(action.executionId, action.seq, false);
          } else if (decision === "deny") {
            await this.runtime().reject({ executionId: action.executionId, seq: action.seq });
            this.options.history.decide(action.executionId, action.seq, saved.inputHash, "denied");
            this.options.history.enqueue(
              `rule-denied:${action.executionId}:${action.seq}`,
              `An owner rule blocked ${action.connector}.${action.method}. Continue only with permitted actions. Do not try to bypass the rule.`
            );
            await this.options.history.flush(this.options.continueTurn);
          }
        }
      } finally {
        this.reviewingRules = false;
      }
    }
    return Promise.all(
      (await this.runtime().pending()).map((action) => this.options.history.pending(action))
    );
  }

  history() {
    return this.options.history.list();
  }

  async approve(executionId: string, seq: number, inputHash: string): Promise<ProxyToolOutput> {
    if (!(await this.options.isActive()))
      throw new Error("Restore this teammate before you approve an action");
    const action = (await this.pending()).find(
      (item) => item.executionId === safeTaskId(executionId) && item.seq === seq
    );
    if (
      action &&
      this.options.permission?.(action.connector, action.method, action.args) === "deny"
    )
      throw new Error("An owner permission rule blocks this action");
    if (
      !action ||
      action.inputHash !== inputHash ||
      !this.options.history.decide(executionId, seq, inputHash, "approved")
    ) {
      throw new Error("This approval is stale. Refresh the action before you decide.");
    }
    await this.options.scheduleRecovery();
    return this.applyApproval(executionId, seq);
  }

  private async applyApproval(
    executionId: string,
    seq: number,
    refresh = true
  ): Promise<ProxyToolOutput> {
    const runtime = this.runtime();
    const output = await runtime.approve({ executionId, seq });
    const call = output.calls?.find((item) => item.seq === seq);
    this.options.history.outcome(
      executionId,
      seq,
      call?.state === "applied" ? "applied" : "uncertain",
      call?.result ?? null
    );
    const message = integrationOutcomeText(output);
    if (output.status !== "paused") {
      this.options.history.enqueue(`integration:${executionId}`, message);
    }
    if (refresh) await this.pending();
    await this.options.markInteraction(message, await integrationApprovalStatus(runtime));
    await this.options.history.flush(this.options.continueTurn);
    return output;
  }

  async recover(): Promise<void> {
    if (!(await this.options.isActive())) return;
    await this.pending();
    const runtime = this.runtime();
    const executions = await runtime.executions(100);
    for (const action of this.options.history
      .list()
      .filter((item) => item.state === "approved" || item.state === "applied")) {
      const execution = executions.find((item) => item.id === action.executionId);
      const call = execution?.log.find((item) => item.seq === action.seq);
      if (execution?.status === "paused" && call?.state === "pending") {
        await this.applyApproval(action.executionId, action.seq);
      } else if (call?.state === "applied") {
        this.options.history.outcome(
          action.executionId,
          action.seq,
          "applied",
          call.result ?? null
        );
        if (execution?.status === "completed") {
          this.options.history.enqueue(
            `integration:${action.executionId}`,
            integrationOutcomeText({
              status: "completed",
              executionId: action.executionId,
              result: execution.result
            })
          );
        }
      } else if (
        action.state === "approved" &&
        Date.now() - Date.parse(action.updatedAt) > 120_000
      ) {
        this.options.history.outcome(action.executionId, action.seq, "uncertain", null);
        await this.options.markEffectUncertain();
      }
    }
    await this.options.history.flush(this.options.continueTurn);
  }

  async resolveUnknown(id: string, result: string, happened: boolean): Promise<void> {
    if (!(await this.options.isActive()))
      throw new Error("Restore this teammate before continuing");
    const action = this.options.history.list().find((item) => item.id === id);
    if (action?.state !== "uncertain") throw new Error("Unknown action not found");
    const evidence = result.trim();
    if (!evidence || evidence.length > 20_000)
      throw new Error("Record the checked outcome before continuing");
    this.options.history.outcome(
      action.executionId,
      action.seq,
      happened ? "confirmed" : "not_applied",
      evidence
    );
    this.options.history.enqueue(
      `resolved:${id}`,
      `The owner checked ${action.connector}.${action.method}. Outcome: ${happened ? "completed" : "did not happen"}. Evidence: ${evidence}. Continue the saved request using this result. A new external action still needs approval.`
    );
    await this.options.scheduleRecovery();
    await this.options.history.flush(this.options.continueTurn);
  }

  async reject(executionId: string, seq: number): Promise<boolean> {
    const runtime = this.runtime();
    const action = (await this.pending()).find(
      (item) => item.executionId === executionId && item.seq === seq
    );
    const rejected = await runtime.reject({ executionId: safeTaskId(executionId), seq });
    if (!rejected) return false;
    if (action) this.options.history.decide(executionId, seq, action.inputHash, "denied");
    const message = "The connected-service action was denied.";
    await this.options.addAssistantMessage(`integration-rejected:${executionId}:${seq}`, message);
    await this.options.markInteraction(message, await integrationApprovalStatus(runtime));
    return true;
  }

  rejectAll(): Promise<number> {
    return rejectPendingIntegrationActions(this.runtime());
  }

  private runtime() {
    const connectors = this.options.readyServers().map(
      ({ connection, id, name }) =>
        new TeammateMcpConnector(
          this.options.ctx,
          this.options.env,
          id,
          name,
          connection,
          this.options.effects,
          this.options.markEffectUncertain,
          this.options.permission,
          this.options.isActive,
          async () => {
            const url = this.list().find((item) => item.id === id)?.url;
            if (!url) throw new Error("Connection was removed");
            await this.options.authorizeServer?.(url);
          }
        )
    );
    return createCodemodeRuntime({
      ctx: this.options.ctx,
      connectors,
      executor: new DynamicWorkerExecutor({ loader: this.options.loader }),
      name: "integrations"
    });
  }
}
