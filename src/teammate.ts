import {
  type ActionAuthorizationDecision,
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
  clearPendingReplyApprovals,
  findReplyApproval,
  replyApprovalOutcome,
  resolveReplyApprovalLifecycle
} from "./runtime/approval";
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
import { concreteLanguageModel, createHQBotModel } from "./runtime/models";
import { routeTurn } from "./runtime/routing";
import { teammateScheduledTasks } from "./runtime/schedules";
import { suspendTeammateWork } from "./runtime/suspension";
import { createTeammateActions, REPLY_PERMISSION } from "./runtime/teammate-actions";
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

export class HQBotTeammate extends Think<Env> {
  maxSteps = 8;
  chatStreamStallTimeoutMs = 120_000;
  workspaceBash = false;
  includeMcpTools = false;
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
    return this.browserRuntime.tools;
  }
  getActions() {
    return createTeammateActions({
      botId: this.name,
      workspaceAgent: this.workspaceAgent,
      delegate: teammateDelegator(this.env.HQBOT_TEAMMATE, this.name)
    });
  }
  authorizeTurn(ctx: TurnContext): ActionAuthorizationDecision {
    const route = routeTurn({
      messages: ctx.messages,
      body: ctx.body,
      metadata: this.activeTurnMetadata
    });
    return {
      allowed: true,
      grantedPermissions: route === "email" ? [REPLY_PERMISSION] : []
    };
  }

  async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    return prepareTeammateTurn({
      botId: this.name,
      browserTools: Object.keys(this.browserRuntime.tools),
      context: ctx,
      maxSteps: this.maxSteps,
      modelFor: (modelId) => this.modelFor(modelId),
      metadata: this.activeTurnMetadata,
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
    const taskId = metadata?.taskId;
    const source = metadata?.source;
    const replyApproval =
      source === "email" && typeof taskId === "string"
        ? findReplyApproval(await this.pendingApprovals(), { taskId })
        : null;
    await finishTeammateResponse({
      botId: this.name,
      metadata,
      replyApproval,
      result,
      workspaceAgent: this.workspaceAgent
    });
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
    return submitChatTurn(input, (messages, options) => this.submitMessages(messages, options));
  }

  @callable()
  submitTask(input: TeammateTaskSubmission) {
    return submitTaskTurn(input, (messages, options) => this.submitMessages(messages, options));
  }

  @callable()
  async replyApprovalForTask(taskId: string): Promise<string | null> {
    const approval = findReplyApproval(await this.pendingApprovals(), {
      taskId: safeTaskId(taskId)
    });
    return approval?.executionId ?? null;
  }

  @callable()
  async resolveReplyApproval(executionId: string, approved: boolean): Promise<boolean> {
    const output = approved
      ? await this.approveExecution(executionId)
      : await this.rejectExecution(executionId, "The owner kept this as a draft");
    const outcome = replyApprovalOutcome(output, approved);
    return approved ? outcome === "approved" : outcome === "rejected";
  }

  @callable()
  override async approveExecution(executionId: string): Promise<unknown> {
    return this.resolveNativeApproval(executionId, true);
  }

  @callable()
  override async rejectExecution(executionId: string, reason?: string): Promise<unknown> {
    return this.resolveNativeApproval(executionId, false, reason);
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
    await clearPendingReplyApprovals({
      taskId: safeId,
      pending: this.pendingApprovals(),
      reject: (executionId) => super.rejectExecution(executionId, "The owner stopped this task")
    });
    await closeBrowserSession(this.browserRuntime);
    this.resetTurnState();
  }

  @callable()
  async suspend(taskIds: string[]): Promise<void> {
    await suspendTeammateWork(this, taskIds);
    await closeBrowserSession(this.browserRuntime);
    this.resetTurnState();
  }

  settleBrowserSession(payload: BrowserSessionLease): Promise<void> {
    return settleBrowserLease(this.browserRuntime, payload, (leases) =>
      this.armBrowserLeases(leases)
    );
  }

  private async resolveNativeApproval(
    executionId: string,
    approved: boolean,
    reason?: string
  ): Promise<unknown> {
    return resolveReplyApprovalLifecycle({
      executionId,
      approved,
      pending: this.pendingApprovals(executionId),
      resolve: () =>
        approved ? super.approveExecution(executionId) : super.rejectExecution(executionId, reason),
      recordRejection: async (taskId) => {
        await this.workspaceAgent.rejectReply(taskId);
      },
      fail: (taskId) =>
        this.workspaceAgent.failTask(taskId, "The approved HQBase reply could not be sent")
    });
  }

  private armBrowserLeases(leases: BrowserSessionLease[]): Promise<void> {
    return scheduleBrowserLeases(leases, (when, lease) =>
      this.schedule(when, "settleBrowserSession", lease, { idempotent: true })
    );
  }
}
