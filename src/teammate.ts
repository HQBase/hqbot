import type { PendingAction, ProxyToolOutput } from "@cloudflare/codemode";
import type {
  ChatResponseResult,
  PrepareStepContext,
  StepConfig,
  StepContext,
  ThinkSubmissionInspection,
  TurnConfig,
  TurnContext
} from "@cloudflare/think";
import { callable } from "agents";
import { type LanguageModel, type ToolSet, tool } from "ai";
import { createComputerBrowserTools } from "./runtime/computer-browser";
import { createComputerDesktopTools } from "./runtime/computer-desktop";
import { createComputerFileTools } from "./runtime/computer-files";
import type { ComputerControlPayload, ComputerLeasePayload } from "./runtime/computer-types";
import { estimateModelUsage, identifyModel } from "./runtime/costs";
import type { LinuxProcessPollPayload } from "./runtime/managed-linux-process";
import { mcpOAuthCallbackResponse, type TeammateConnection } from "./runtime/mcp";
import { listHQBotModels, modelTokenRates } from "./runtime/model-catalog";
import { concreteLanguageModel, createHQBotModel } from "./runtime/models";
import { createStopProcessTool } from "./runtime/process-tools";
import { createScheduleTool } from "./runtime/schedule-tool";
import { teammateScheduledTasks } from "./runtime/schedules";
import { clearLegacyScreenshotReplayError } from "./runtime/screenshot-replay-recovery";
import { suspendTeammateWork } from "./runtime/suspension";
import { taskManagementInput } from "./runtime/task-management";
import { createTeammateLinuxTool } from "./runtime/teammate-linux";
import {
  finishTeammateResponse,
  prepareTeammateTurn,
  submitChatTurn,
  teammateResponseText
} from "./runtime/turn";
import {
  GLM_PRIMARY_MODEL_ID,
  type HQBotModelId,
  type TeammateChatSubmission
} from "./runtime/types";
import { migrateTeammateWork, type WorkResumePayload } from "./runtime/work";
import { FIRST_MESSAGE_STOPPED_KEY, TeammateRuntime } from "./teammate-runtime";
import type { Sql } from "./workspace/sql";

export class HQBotTeammate extends TeammateRuntime {
  maxSteps = Number.POSITIVE_INFINITY;
  chatStreamStallTimeoutMs = 120_000;
  workspaceBash = false;
  includeMcpTools = false;
  waitForMcpConnections = { timeout: 10_000 };
  storeMessages = false;
  storeTools = false;

  private attemptedModel: HQBotModelId = GLM_PRIMARY_MODEL_ID;
  private modelCatalog: ReturnType<typeof listHQBotModels> | null = null;

  private modelFor(modelId: HQBotModelId): LanguageModel {
    return createHQBotModel({
      primaryModelId: modelId,
      resolve: (id) => concreteLanguageModel(this.resolveModel(id)),
      onAttempt: (id) => {
        this.attemptedModel = id;
      }
    });
  }

  getModel = () => this.modelFor(GLM_PRIMARY_MODEL_ID);

  getTools(): ToolSet {
    const tools: ToolSet = {
      ...createComputerBrowserTools({
        botId: this.name,
        computer: this.computerRuntime,
        taskId: () => this.currentTaskId()
      }),
      ...createComputerDesktopTools({
        botId: this.name,
        computer: this.computerRuntime,
        taskId: () => this.currentTaskId()
      }),
      ...createComputerFileTools({
        botId: this.name,
        bucket: this.env.ARTIFACTS,
        catalog: this.workspaceAgent,
        computer: this.computerRuntime,
        taskId: () => this.currentTaskId()
      }),
      bash: createTeammateLinuxTool(
        this.env,
        this.name,
        this.workspaceAgent,
        () => this.currentTaskId(),
        this.computerRuntime,
        (input) => this.processes.start(input),
        (input) => this.processes.resume(input)
      ),
      manage_task: tool({
        description:
          "Save or finish the one active task. Use this only when work must continue in the next turn, wait for the owner, or finish an existing task. Use schedule for future times. A normal answer does not need a task.",
        inputSchema: taskManagementInput,
        execute: (input) => {
          this.tasks.assertManageAvailable();
          return this.tasks.run(() => this.tasks.manage(input));
        },
        toModelOutput: ({ output }) => ({ type: "text", value: JSON.stringify(output) })
      }),
      schedule: createScheduleTool({
        botId: this.name,
        reconcile: () => this.internal_reconcileScheduledTasks(),
        tasks: this.tasks,
        workspaceAgent: this.workspaceAgent
      }),
      stop_process: createStopProcessTool({ stop: (processId) => this.processes.stop(processId) })
    };
    return this.integrationRuntime.hasReadyConnection()
      ? { ...tools, codemode: this.integrationRuntime.tool() }
      : tools;
  }

  async onStart(): Promise<void> {
    await clearLegacyScreenshotReplayError(this.ctx.storage).catch(() => false);
    migrateTeammateWork(this.sql.bind(this) as Sql);
    this.mcp.configureOAuthCallback({
      customHandler: (result) => mcpOAuthCallbackResponse(result.authSuccess)
    });
    await this.schedule(
      new Date(Date.now() + 1_000),
      "recoverRuntime",
      {},
      {
        idempotent: true,
        retry: { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 10_000 }
      }
    );
  }

  async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    const activeWork = this.tasks.active();
    if (
      this.activeTurnMetadata?.source === "active-task" &&
      (!activeWork ||
        this.activeTurnMetadata.taskId !== activeWork.taskId ||
        this.activeTurnMetadata.generation !== activeWork.generation ||
        activeWork.state !== "running")
    )
      throw new Error("This task continuation is stale");
    return prepareTeammateTurn({
      activeWork,
      botId: this.name,
      connectedServices: this.integrationRuntime
        .list()
        .filter((connection) => connection.status === "ready")
        .map((connection) => connection.name),
      context: ctx,
      maxSteps: this.maxSteps,
      modelFor: (modelId) => this.modelFor(modelId),
      metadata: this.activeTurnMetadata,
      workspaceAgent: this.workspaceAgent
    });
  }

  beforeStep(ctx: PrepareStepContext): StepConfig | undefined {
    const scheduleChanged = ctx.steps
      .at(-1)
      ?.toolResults.some(
        (result) =>
          result.toolName === "schedule" &&
          typeof result.output === "object" &&
          result.output !== null &&
          ("schedule" in result.output || "deleted" in result.output)
      );
    if (scheduleChanged) return { toolChoice: "none" } as unknown as StepConfig;
  }

  async onStepFinish(ctx: StepContext): Promise<void> {
    const model = identifyModel(ctx.response.modelId, this.attemptedModel);
    this.modelCatalog ??= listHQBotModels(this.env.AI);
    await this.workspaceAgent.recordUsage(
      estimateModelUsage({
        botId: this.name,
        taskId: this.currentTaskId(),
        model,
        rates: modelTokenRates(await this.modelCatalog, model),
        usage: ctx.usage
      })
    );
  }

  async onChatResponse(result: ChatResponseResult): Promise<void> {
    await this.tasks.run(() =>
      this.tasks.settleTurn(
        this.activeTurnMetadata?.taskId,
        this.activeTurnMetadata?.generation,
        result.status,
        teammateResponseText(result),
        result.error
      )
    );
    const activeWork = this.tasks.active();
    await finishTeammateResponse({
      botId: this.name,
      interactionStatus:
        activeWork?.state === "running" || this.processes.active() ? "working" : "idle",
      result,
      workspaceAgent: this.workspaceAgent
    });
    if ((await this.integrationRuntime.pending()).length > 0) {
      await this.workspaceAgent.markInteraction(
        this.name,
        "Action needs approval",
        "needs_approval"
      );
    }
    await this.computerRuntime.recoveryCheckpoint().catch(() => undefined);
  }

  protected onSubmissionStatus(submission: ThinkSubmissionInspection): Promise<void> {
    return this.tasks.run(() => this.tasks.settleSubmission(submission));
  }

  async getScheduledTasks() {
    return teammateScheduledTasks(await this.workspaceAgent.listRoutines(this.name), () =>
      this.computerRuntime.recoveryCheckpoint()
    );
  }

  @callable()
  async reconcileScheduledTasks(): Promise<void> {
    await this.internal_reconcileScheduledTasks();
  }

  async recoverRuntime(): Promise<void> {
    await this.computerRuntime.reconcileOwnerControl();
    await this.processes.reconcile();
    await this.tasks.reconcile();
  }

  @callable()
  submitChat(input: TeammateChatSubmission) {
    const firstSubmission = input.submissionId === `first:${this.name}`;
    return submitChatTurn(input, (messages, options) => this.submitMessages(messages, options), {
      cancel: (id, reason) => this.cancelSubmission(id, reason),
      inspect: (id) => this.inspectSubmission(id),
      messageApplied: (id) => this.messages.some((message) => message.id === id),
      stopped: async () =>
        firstSubmission && Boolean(await this.ctx.storage.get<boolean>(FIRST_MESSAGE_STOPPED_KEY))
    });
  }

  @callable()
  listConnections(): TeammateConnection[] {
    return this.integrationRuntime.list();
  }

  @callable()
  connectMcp(input: { name: string; url: string; token?: string }): Promise<TeammateConnection> {
    return this.integrationRuntime.connect(input);
  }

  @callable()
  disconnectMcp(id: string): Promise<void> {
    return this.integrationRuntime.disconnect(id);
  }

  @callable()
  listIntegrationApprovals(): Promise<PendingAction[]> {
    return this.integrationRuntime.pending();
  }

  @callable()
  approveIntegrationAction(executionId: string): Promise<ProxyToolOutput> {
    return this.integrationRuntime.approve(executionId);
  }

  @callable()
  rejectIntegrationAction(executionId: string, seq: number): Promise<boolean> {
    return this.integrationRuntime.reject(executionId, seq);
  }

  getComputerStatus() {
    return this.computerRuntime.status();
  }

  setComputerControl(ownerControl: boolean) {
    return this.computerRuntime.setOwnerControl(ownerControl);
  }

  renewComputerControl() {
    return this.computerRuntime.setOwnerControl(true, true);
  }

  @callable()
  async suspend(): Promise<void> {
    await this.ctx.storage.put(FIRST_MESSAGE_STOPPED_KEY, true);
    await suspendTeammateWork(this);
    await this.closeRuntimeResources();
  }

  async stopActivity(reason = "The owner stopped this teammate"): Promise<void> {
    await this.ctx.storage.put(FIRST_MESSAGE_STOPPED_KEY, true);
    await suspendTeammateWork(this, reason);
    await this.workspaceAgent.markInteraction(this.name, "Activity stopped", "idle");
    this.resetTurnState();
    await this.schedule(
      new Date(Date.now() + 1_000),
      "finishStopping",
      {},
      {
        idempotent: true,
        retry: { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 10_000 }
      }
    );
  }

  async finishStopping(): Promise<void> {
    await this.closeRuntimeResources();
    await this.internal_reconcileScheduledTasks();
  }

  resumeTask(payload: WorkResumePayload): Promise<void> {
    return this.tasks.resume(payload);
  }

  pollLinuxProcess(payload: LinuxProcessPollPayload): Promise<void> {
    return this.processes.poll(payload);
  }

  async cancelActiveTask(reason = "The owner stopped this task"): Promise<void> {
    await this.tasks.cancel(reason);
  }

  async destroySoon(): Promise<void> {
    await this._cf_scheduleDestroy();
  }

  settleComputer(payload: ComputerLeasePayload): Promise<void> {
    return this.computerRuntime.settle(payload);
  }

  settleComputerControl(payload: ComputerControlPayload): Promise<void> {
    return this.computerRuntime.settleOwnerControl(payload);
  }
}
