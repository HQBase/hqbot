import {
  createCodemodeRuntime,
  DynamicWorkerExecutor,
  type McpConnectionLike,
  type PendingAction,
  type ProxyToolOutput
} from "@cloudflare/codemode";
import {
  type ChatResponseResult,
  type StepContext,
  Think,
  type ToolCallResultContext,
  type TurnConfig,
  type TurnContext,
  Workspace
} from "@cloudflare/think";
import { callable } from "agents";
import type { LanguageModel, ToolSet } from "ai";

import {
  type BrowserSessionLease,
  closeBrowserSession,
  createTeammateBrowserRuntime,
  keepBrowserLiveViewAlive,
  type MeteredBrowserRuntime,
  openBrowserLiveView,
  scheduleBrowserLeases,
  settleBrowserLease
} from "./runtime/browser";
import { executeDelegatedTask, teammateDelegator } from "./runtime/collaboration";
import { estimateModelUsage, identifyModel } from "./runtime/costs";
import {
  integrationApprovalStatus,
  rejectPendingIntegrationActions
} from "./runtime/integration-lifecycle";
import { TeammateMcpConnector } from "./runtime/integrations";
import {
  cleanBearerToken,
  cleanConnectionName,
  cleanConnectionUrl,
  connectionList,
  integrationOutcomeText,
  mcpConnectorName,
  mcpOAuthCallbackResponse,
  type TeammateConnection
} from "./runtime/mcp";
import { concreteLanguageModel, createHQBotModel } from "./runtime/models";
import { teammateScheduledTasks } from "./runtime/schedules";
import { suspendTeammateWork } from "./runtime/suspension";
import { createTeammateActions } from "./runtime/teammate-actions";
import {
  finishTeammateResponse,
  prepareTeammateTurn,
  safeTaskId,
  submitChatTurn,
  submitTaskTurn
} from "./runtime/turn";
import {
  type DelegatedTaskInput,
  type DelegatedTaskResult,
  GLM_PRIMARY_MODEL_ID,
  type HQBotModelId,
  type TeammateChatSubmission,
  type TeammateTaskSubmission,
  type WorkspaceAgentRpc
} from "./runtime/types";

const FIRST_MESSAGE_STOPPED_KEY = "hqbot:first-message-stopped";

export class HQBotTeammate extends Think<Env> {
  maxSteps = 8;
  chatStreamStallTimeoutMs = 120_000;
  workspaceBash = false;
  includeMcpTools = false;
  waitForMcpConnections = { timeout: 10_000 };
  storeMessages = false;
  storeTools = false;

  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.ARTIFACTS,
    name: () => `teammates/${this.name}`
  });

  private attemptedModel: HQBotModelId = GLM_PRIMARY_MODEL_ID;
  private browser: MeteredBrowserRuntime | null = null;

  private get workspaceAgent(): WorkspaceAgentRpc {
    return this.env.HQBOT_AGENT.getByName(this.env.HQBOT_ID) as unknown as WorkspaceAgentRpc;
  }

  private get browserRuntime(): MeteredBrowserRuntime {
    this.browser ??= createTeammateBrowserRuntime(
      this.ctx,
      this.env.BROWSER,
      this.env.LOADER,
      this.name,
      () => this.activeTurnMetadata?.taskId,
      this.workspaceAgent
    );
    return this.browser;
  }

  private modelFor(modelId: HQBotModelId): LanguageModel {
    return createHQBotModel({
      primaryModelId: modelId,
      resolve: (modelId) => concreteLanguageModel(this.resolveModel(modelId)),
      onAttempt: (modelId) => {
        this.attemptedModel = modelId;
      }
    });
  }
  getModel(): LanguageModel {
    return this.modelFor(GLM_PRIMARY_MODEL_ID);
  }
  getTools(): ToolSet {
    const hasReadyConnection = Object.values(this.getMcpServers().servers).some(
      (server) => server.state === "ready"
    );
    return hasReadyConnection
      ? {
          ...this.browserRuntime.tools,
          codemode: this.integrationRuntime().tool({
            description:
              "Use connected services with compact TypeScript. Search and describe tools before calling them. Every connected-service tool call pauses for owner approval."
          })
        }
      : this.browserRuntime.tools;
  }
  getActions() {
    return createTeammateActions({
      botId: this.name,
      workspaceAgent: this.workspaceAgent,
      delegate: teammateDelegator(this.env.HQBOT_TEAMMATE, this.name)
    });
  }

  onStart(): void {
    this.mcp.configureOAuthCallback({
      customHandler: (result) => mcpOAuthCallbackResponse(result.authSuccess)
    });
  }
  async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    return prepareTeammateTurn({
      botId: this.name,
      connectedServices: connectionList(this.getMcpServers())
        .filter((connection) => connection.status === "ready")
        .map((connection) => connection.name),
      context: ctx,
      maxSteps: this.maxSteps,
      modelFor: (modelId) => this.modelFor(modelId),
      metadata: this.activeTurnMetadata,
      toolNames: Object.keys(this.getTools()),
      workspaceAgent: this.workspaceAgent
    });
  }
  async onStepFinish(ctx: StepContext): Promise<void> {
    const model = identifyModel(ctx.response.modelId, this.attemptedModel);
    const taskId = this.activeTurnMetadata?.taskId;
    await this.workspaceAgent.recordUsage(
      estimateModelUsage({
        botId: this.name,
        taskId: typeof taskId === "string" ? taskId : null,
        model,
        usage: ctx.usage
      })
    );
  }
  async afterToolCall(ctx: ToolCallResultContext): Promise<void> {
    if (ctx.toolName !== "browser_execute") return;
    const taskId = this.activeTurnMetadata?.taskId;
    const leases = await this.browserRuntime.meter.touch(
      typeof taskId === "string" ? taskId : null
    );
    await this.armBrowserLeases(leases);
  }
  async onChatResponse(result: ChatResponseResult): Promise<void> {
    const metadata =
      this.activeTurnMetadata ?? (await this.inspectSubmission(result.requestId))?.metadata;
    await finishTeammateResponse({
      botId: this.name,
      metadata,
      result,
      workspaceAgent: this.workspaceAgent
    });
    if ((await this.integrationRuntime().pending()).length > 0) {
      await this.workspaceAgent.markInteraction(
        this.name,
        "Action needs approval",
        "needs_approval"
      );
    }
  }
  async getScheduledTasks() {
    return teammateScheduledTasks(await this.workspaceAgent.listRoutines(this.name), async () => {
      await this.browserRuntime.connector.sweep();
      await this.browserRuntime.meter.flush();
    });
  }
  async runDelegatedTask(input: DelegatedTaskInput): Promise<DelegatedTaskResult> {
    return executeDelegatedTask(input, {
      targetId: this.name,
      listBots: () => this.workspaceAgent.listBots(),
      run: (prompt, signal) =>
        this.runTurn({ mode: "wait", input: prompt, body: { delegation: true }, signal })
    });
  }
  @callable()
  async reconcileScheduledTasks(): Promise<void> {
    await this.internal_reconcileScheduledTasks();
  }
  @callable()
  submitChat(input: TeammateChatSubmission) {
    const firstSubmission = input.submissionId === `first:${this.name}`;
    return submitChatTurn(input, (messages, options) => this.submitMessages(messages, options), {
      cancel: (submissionId, reason) => this.cancelSubmission(submissionId, reason),
      inspect: (submissionId) => this.inspectSubmission(submissionId),
      messageApplied: (messageId) => this.messages.some((message) => message.id === messageId),
      stopped: async () =>
        firstSubmission && Boolean(await this.ctx.storage.get<boolean>(FIRST_MESSAGE_STOPPED_KEY))
    });
  }
  @callable()
  submitTask(input: TeammateTaskSubmission) {
    return submitTaskTurn(input, (messages, options) => this.submitMessages(messages, options));
  }
  @callable()
  listConnections(): TeammateConnection[] {
    return connectionList(this.getMcpServers());
  }
  @callable()
  async connectMcp(input: {
    name: string;
    url: string;
    token?: string;
  }): Promise<TeammateConnection> {
    const bot = await this.workspaceAgent.getBot(this.name);
    if (!bot || bot.hidden) throw new Error("Restore this teammate before you add a connection");
    const name = cleanConnectionName(input.name);
    const url = cleanConnectionUrl(input.url);
    const token = cleanBearerToken(input.token);
    const result = await this.addMcpServer(name, url, {
      transport: {
        type: "auto",
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {})
      }
    });
    const connection = connectionList(this.getMcpServers()).find((item) => item.id === result.id);
    if (!connection) throw new Error("The connection state is not available");
    return result.state === "authenticating"
      ? { ...connection, authUrl: result.authUrl }
      : connection;
  }
  @callable()
  async disconnectMcp(id: string): Promise<void> {
    if (!this.getMcpServers().servers[id]) throw new Error("Connection not found");
    const runtime = this.integrationRuntime();
    const rejected = await rejectPendingIntegrationActions(runtime, mcpConnectorName(id));
    await this.removeMcpServer(id);
    if (rejected > 0) {
      await this.workspaceAgent.markInteraction(
        this.name,
        "Connection removed",
        await integrationApprovalStatus(runtime)
      );
    }
  }
  @callable()
  async listIntegrationApprovals(): Promise<PendingAction[]> {
    return this.integrationRuntime().pending();
  }

  @callable()
  async approveIntegrationAction(executionId: string): Promise<ProxyToolOutput> {
    const bot = await this.workspaceAgent.getBot(this.name);
    if (!bot || bot.hidden) throw new Error("Restore this teammate before you approve an action");
    const runtime = this.integrationRuntime();
    const output = await runtime.approve({ executionId: safeTaskId(executionId) });
    const message = integrationOutcomeText(output);
    await this.addMessages([
      {
        id: `integration:${output.executionId}:${Date.now()}`,
        role: "assistant",
        parts: [{ type: "text", text: message }]
      }
    ]);
    await this.workspaceAgent.markInteraction(
      this.name,
      message,
      await integrationApprovalStatus(runtime)
    );
    return output;
  }

  @callable()
  async rejectIntegrationAction(executionId: string, seq: number): Promise<boolean> {
    const runtime = this.integrationRuntime();
    const rejected = await runtime.reject({ executionId: safeTaskId(executionId), seq });
    if (rejected) {
      const message = "The connected-service action was denied.";
      await this.addMessages([
        {
          id: `integration-rejected:${executionId}:${Date.now()}`,
          role: "assistant",
          parts: [{ type: "text", text: message }]
        }
      ]);
      await this.workspaceAgent.markInteraction(
        this.name,
        message,
        await integrationApprovalStatus(runtime)
      );
    }
    return rejected;
  }

  @callable()
  async getLiveView(mode: "tab" | "devtools" = "tab") {
    return openBrowserLiveView(this.browserRuntime, mode, (leases) =>
      this.armBrowserLeases(leases)
    );
  }

  @callable()
  async keepLiveViewAlive(sessionId: string, taskId?: string): Promise<boolean> {
    return keepBrowserLiveViewAlive(this.browserRuntime, sessionId, taskId ?? null, (leases) =>
      this.armBrowserLeases(leases)
    );
  }

  @callable()
  closeLiveView(): Promise<void> {
    return closeBrowserSession(this.browserRuntime);
  }
  @callable()
  async cancelTask(taskId: string): Promise<void> {
    const safeId = safeTaskId(taskId);
    await this.cancelSubmission(safeId, "The owner stopped this task");
    await rejectPendingIntegrationActions(this.integrationRuntime());
    await closeBrowserSession(this.browserRuntime);
    this.resetTurnState();
  }

  @callable()
  async suspend(taskIds: string[]): Promise<void> {
    await this.ctx.storage.put(FIRST_MESSAGE_STOPPED_KEY, true);
    await suspendTeammateWork(this, taskIds);
    await rejectPendingIntegrationActions(this.integrationRuntime());
    await closeBrowserSession(this.browserRuntime);
    this.resetTurnState();
  }

  async stopActivity(taskIds: string[], reason = "The owner stopped this teammate"): Promise<void> {
    await this.ctx.storage.put(FIRST_MESSAGE_STOPPED_KEY, true);
    await suspendTeammateWork(this, taskIds, reason);
    await rejectPendingIntegrationActions(this.integrationRuntime());
    await closeBrowserSession(this.browserRuntime);
    this.resetTurnState();
  }

  async destroySoon(): Promise<void> {
    await this.schedule(1, "destroyStorage", null, { idempotent: true });
  }

  async destroyStorage(): Promise<void> {
    await this.destroy();
  }

  settleBrowserSession(payload: BrowserSessionLease): Promise<void> {
    return settleBrowserLease(this.browserRuntime, payload, (leases) =>
      this.armBrowserLeases(leases)
    );
  }

  private integrationRuntime() {
    const state = this.getMcpServers();
    const connectors = Object.entries(state.servers).flatMap(([id, server]) => {
      if (server.state !== "ready") return [];
      const connection = this.mcp.mcpConnections[id] as McpConnectionLike | undefined;
      return connection
        ? [new TeammateMcpConnector(this.ctx, this.env, id, server.name, connection)]
        : [];
    });
    return createCodemodeRuntime({
      ctx: this.ctx,
      connectors,
      executor: new DynamicWorkerExecutor({ loader: this.env.LOADER }),
      name: "integrations"
    });
  }

  private armBrowserLeases(leases: BrowserSessionLease[]): Promise<void> {
    return scheduleBrowserLeases(leases, (when, lease) =>
      this.schedule(when, "settleBrowserSession", lease, { idempotent: true })
    );
  }
}
