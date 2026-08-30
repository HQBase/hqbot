import {
  type ActionAuthorizationDecision,
  type ChatResponseResult,
  type StepContext,
  Think,
  type ThinkScheduledTasks,
  type ToolCallResultContext,
  type TurnConfig,
  type TurnContext,
  Workspace
} from "@cloudflare/think";
import type { BrowserRuntime } from "@cloudflare/think/tools/browser";
import { callable, getAgentByName } from "agents";
import type { LanguageModel, ToolSet, UIMessage } from "ai";

import {
  findReplyApproval,
  replyApprovalOutcome,
  resolveReplyApprovalLifecycle
} from "./runtime/approval";
import { createTeammateBrowserRuntime } from "./runtime/browser";
import { executeDelegatedTask } from "./runtime/collaboration";
import { estimateModelUsage, identifyModel } from "./runtime/costs";
import { concreteLanguageModel, createHQBotModel } from "./runtime/models";
import { routeTurn } from "./runtime/routing";
import { intervalSchedule } from "./runtime/schedules";
import { createTeammateActions, REPLY_PERMISSION } from "./runtime/teammate-actions";
import { prepareTeammateTurn, safeTaskId } from "./runtime/turn";
import {
  type DelegatedTaskInput,
  type DelegatedTaskResult,
  GLM_PRIMARY_MODEL_ID,
  type HQBotModelId,
  type LiveViewDto,
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

  private model: LanguageModel | null = null;
  private attemptedModel: HQBotModelId = GLM_PRIMARY_MODEL_ID;
  private browser: BrowserRuntime | null = null;

  private get workspaceAgent(): WorkspaceAgentRpc {
    return this.env.HQBOT_AGENT.getByName(this.env.HQBOT_ID) as unknown as WorkspaceAgentRpc;
  }

  private get browserRuntime(): BrowserRuntime {
    this.browser ??= createTeammateBrowserRuntime(
      this.ctx,
      this.env.BROWSER,
      this.env.LOADER,
      this.name
    );
    return this.browser;
  }

  getModel(): LanguageModel {
    this.model ??= createHQBotModel({
      resolve: (modelId) => concreteLanguageModel(this.resolveModel(modelId)),
      onAttempt: (modelId) => {
        this.attemptedModel = modelId;
      }
    });
    return this.model;
  }

  getTools(): ToolSet {
    return this.browserRuntime.tools;
  }

  getActions() {
    return createTeammateActions({
      botId: this.name,
      workspaceAgent: this.workspaceAgent,
      delegate: async (target, task) => {
        const teammate = await getAgentByName<Env, HQBotTeammate>(
          this.env.HQBOT_TEAMMATE,
          target.id
        );
        return teammate.runDelegatedTask({ requesterId: this.name, task });
      }
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
    if (!Object.hasOwn(this.browserRuntime.tools, ctx.toolName)) return;
    const taskId = this.activeTurnMetadata?.taskId;
    const milliseconds = Math.max(1_000, ctx.toolExecutionMs);
    await this.workspaceAgent.recordResourceUsage({
      botId: this.name,
      taskId: typeof taskId === "string" ? taskId : null,
      service: "browser",
      units: milliseconds,
      estimatedCostMicroUsd: Math.round((milliseconds / 3_600_000) * 0.09 * 1_000_000)
    });
  }

  async onChatResponse(result: ChatResponseResult): Promise<void> {
    const taskId = this.activeTurnMetadata?.taskId;
    const source = this.activeTurnMetadata?.source;
    if (typeof taskId !== "string") return;
    if (source === "email") {
      const approval = findReplyApproval(await this.pendingApprovals(), { taskId });
      if (approval) {
        await this.workspaceAgent.requestReplyApproval(taskId, approval.draft);
      } else if (result.status === "error") {
        await this.workspaceAgent.failTask(taskId, result.error ?? "The email task failed");
      }
      return;
    }
    if (result.status === "error") {
      await this.workspaceAgent.failTask(taskId, result.error ?? "The task failed");
      return;
    }
    if (result.status !== "completed") return;
    const text = result.message.parts
      .filter(
        (part): part is Extract<(typeof result.message.parts)[number], { type: "text" }> =>
          part.type === "text"
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) await this.workspaceAgent.completeTask(taskId, text, null);
  }

  async getScheduledTasks(): Promise<ThinkScheduledTasks> {
    const routines = await this.workspaceAgent.listRoutines(this.name);
    const tasks: ThinkScheduledTasks = {
      "system:browser-sweep": {
        schedule: "every 1 hour",
        handler: async () => {
          await this.browserRuntime.connector.sweep();
        }
      }
    };
    for (const routine of routines) {
      if (!routine.active) continue;
      tasks[`routine:${routine.id}`] = {
        schedule: intervalSchedule(routine.intervalMinutes),
        prompt: `[hqbot:routine]\n${routine.name}\n\n${routine.prompt}`,
        metadata: { routineId: routine.id, source: "routine" }
      };
    }
    return tasks;
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
  async submitTask(
    input: TeammateTaskSubmission
  ): Promise<{ accepted: boolean; submissionId: string }> {
    const taskId = safeTaskId(input.taskId);
    const prompt = input.prompt.trim().slice(0, 100_000);
    if (prompt.length === 0) throw new Error("Task prompt is required");
    const text =
      input.source === "email" ? `[hqbot:email]\nTask ID: ${taskId}\n\n${prompt}` : prompt;
    const message: UIMessage = {
      id: `task:${taskId}`,
      role: "user",
      parts: [{ type: "text", text }]
    };
    const result = await this.submitMessages([message], {
      submissionId: taskId,
      idempotencyKey: `task:${taskId}`,
      metadata: { taskId, source: input.source },
      channel: "web"
    });
    return { accepted: result.accepted, submissionId: result.submissionId };
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
  async getLiveView(mode: "tab" | "devtools" = "tab"): Promise<LiveViewDto | null> {
    return (await this.browserRuntime.connector.liveView({ mode })) ?? null;
  }

  @callable()
  async closeLiveView(): Promise<void> {
    await this.browserRuntime.connector.closeSession();
  }

  @callable()
  async cancelTask(taskId: string): Promise<void> {
    await this.cancelSubmission(safeTaskId(taskId), "The owner stopped this task");
    this.cancelAllChats();
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
      recordRejection: (taskId) => this.workspaceAgent.recordReplyDecision(taskId, false),
      fail: (taskId) =>
        this.workspaceAgent.failTask(taskId, "The approved HQBase reply could not be sent")
    });
  }
}
