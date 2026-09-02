import {
  createCodemodeRuntime,
  DynamicWorkerExecutor,
  type McpConnectionLike,
  type PendingAction,
  type ProxyToolOutput
} from "@cloudflare/codemode";
import type { Tool } from "ai";

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
  botId: string;
  ctx: Parameters<typeof createCodemodeRuntime>[0]["ctx"];
  effects: TeammateExternalEffects;
  env: Env;
  isActive: () => Promise<boolean>;
  loader: ConstructorParameters<typeof DynamicWorkerExecutor>[0]["loader"];
  list: () => TeammateConnection[];
  markEffectUncertain: () => Promise<void>;
  markInteraction: (summary: string, status: "idle" | "needs_approval") => Promise<void>;
  readyServers: () => ReadyServer[];
  removeServer: (id: string) => Promise<void>;
  serverExists: (id: string) => boolean;
}

export class TeammateIntegrations {
  constructor(private readonly options: TeammateIntegrationsOptions) {}

  list(): TeammateConnection[] {
    return this.options.list();
  }

  hasReadyConnection(): boolean {
    return this.options.readyServers().length > 0;
  }

  tool(): Tool {
    return this.runtime().tool({
      description:
        "Use connected services with compact TypeScript. Search and describe tools before calling them. Every connected-service tool call pauses for owner approval."
    });
  }

  async connect(input: { name: string; url: string; token?: string }): Promise<TeammateConnection> {
    if (!(await this.options.isActive())) {
      throw new Error("Restore this teammate before you add a connection");
    }
    const result = await this.options.addServer(
      cleanConnectionName(input.name),
      cleanConnectionUrl(input.url),
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

  async pending(): Promise<PendingAction[]> {
    return this.runtime().pending();
  }

  async approve(executionId: string): Promise<ProxyToolOutput> {
    if (!(await this.options.isActive())) {
      throw new Error("Restore this teammate before you approve an action");
    }
    const runtime = this.runtime();
    const output = await runtime.approve({ executionId: safeTaskId(executionId) });
    const message = integrationOutcomeText(output);
    await this.options.addAssistantMessage(
      `integration:${output.executionId}:${Date.now()}`,
      message
    );
    await this.options.markInteraction(message, await integrationApprovalStatus(runtime));
    return output;
  }

  async reject(executionId: string, seq: number): Promise<boolean> {
    const runtime = this.runtime();
    const rejected = await runtime.reject({ executionId: safeTaskId(executionId), seq });
    if (!rejected) return false;
    const message = "The connected-service action was denied.";
    await this.options.addAssistantMessage(
      `integration-rejected:${executionId}:${Date.now()}`,
      message
    );
    await this.options.markInteraction(message, await integrationApprovalStatus(runtime));
    return true;
  }

  rejectAll(): Promise<number> {
    return rejectPendingIntegrationActions(this.runtime());
  }

  private runtime() {
    const connectors = this.options
      .readyServers()
      .map(
        ({ connection, id, name }) =>
          new TeammateMcpConnector(
            this.options.ctx,
            this.options.env,
            id,
            name,
            connection,
            this.options.effects,
            this.options.markEffectUncertain
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
