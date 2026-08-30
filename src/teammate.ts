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
import { callable, getAgentByName } from "agents";
import type { LanguageModel, ToolSet } from "ai";

import {
  clearPendingReplyApprovals,
  findReplyApproval,
  replyApprovalOutcome,
  resolveReplyApprovalLifecycle
} from "./runtime/approval";
import {
  createTeammateBrowserRuntime,
  estimateBrowserMicroUsd,
  type MeteredBrowserRuntime
} from "./runtime/browser";
import type { BrowserSessionLease } from "./runtime/browser-meter";
import { executeDelegatedTask } from "./runtime/collaboration";
import { estimateModelUsage, identifyModel } from "./runtime/costs";
import { concreteLanguageModel, createHQBotModel } from "./runtime/models";
import { routeTurn } from "./runtime/routing";
import { intervalSchedule } from "./runtime/schedules";
import { createTeammateActions, REPLY_PERMISSION } from "./runtime/teammate-actions";
import {
  createSubmittedTaskMessage,
  finishTeammateResponse,
  prepareTeammateTurn,
  safeTaskId
} from "./runtime/turn";
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
      () => {
        const taskId = this.activeTurnMetadata?.taskId;
        return typeof taskId === "string" ? taskId : null;
      },
      async (sample) => {
        await this.workspaceAgent.recordResourceUsage({
          eventId: sample.eventId,
          botId: this.name,
          taskId: sample.taskId,
          service: "browser",
          units: sample.milliseconds,
          estimatedCostMicroUsd: estimateBrowserMicroUsd(sample.milliseconds)
        });
      }
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

  async getScheduledTasks(): Promise<ThinkScheduledTasks> {
    const routines = await this.workspaceAgent.listRoutines(this.name);
    const tasks: ThinkScheduledTasks = {
      "system:browser-sweep": {
        schedule: "every 1 hour",
        handler: async () => {
          await this.browserRuntime.connector.sweep();
          await this.browserRuntime.meter.flush();
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
    const { message, metadata } = createSubmittedTaskMessage(input);
    const taskId = metadata.taskId;
    const result = await this.submitMessages([message], {
      submissionId: taskId,
      idempotencyKey: `task:${taskId}`,
      metadata,
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
    const view = (await this.browserRuntime.connector.liveView({ mode })) ?? null;
    await this.browserRuntime.meter.flush();
    if (view)
      await this.armBrowserLeases(await this.browserRuntime.meter.touch(null, view.sessionId));
    return view;
  }

  @callable()
  async keepLiveViewAlive(sessionId: string, taskId?: string): Promise<boolean> {
    const info = await this.browserRuntime.connector.sessionInfo();
    await this.browserRuntime.meter.flush();
    if (!info || info.sessionId !== sessionId) return false;
    const leases = await this.browserRuntime.meter.touch(taskId ?? null, sessionId);
    await this.armBrowserLeases(leases);
    return leases.length > 0;
  }

  @callable()
  async closeLiveView(): Promise<void> {
    await this.browserRuntime.meter.closeSession(() =>
      this.browserRuntime.connector.closeSession()
    );
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
    await this.browserRuntime.meter.closeSession(() =>
      this.browserRuntime.connector.closeSession()
    );
    this.resetTurnState();
  }

  async settleBrowserSession(payload: BrowserSessionLease): Promise<void> {
    const lease = (await this.browserRuntime.meter.leases(payload.sessionId))[0];
    if (!lease) return;
    if (lease.deadline > Date.now()) {
      await this.armBrowserLeases([lease]);
      return;
    }

    const info = await this.browserRuntime.connector.sessionInfo();
    await this.browserRuntime.meter.flush();
    if (!info || info.sessionId !== payload.sessionId) return;
    const current = (await this.browserRuntime.meter.leases(payload.sessionId))[0];
    if (!current) return;
    if (current.deadline > Date.now()) {
      await this.armBrowserLeases([current]);
      return;
    }
    await this.browserRuntime.meter.closeSession(() =>
      this.browserRuntime.connector.closeSession()
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

  private async armBrowserLeases(leases: BrowserSessionLease[]): Promise<void> {
    for (const lease of leases) {
      const when = new Date(Math.max(Date.now() + 1_000, lease.deadline));
      await this.schedule(when, "settleBrowserSession", lease, { idempotent: true });
    }
  }
}
