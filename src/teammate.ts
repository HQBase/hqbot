import type { ProxyToolOutput } from "@cloudflare/codemode";
import type {
  ChatResponseResult,
  PrepareStepContext,
  StepConfig,
  ThinkSubmissionInspection,
  TurnConfig,
  TurnContext
} from "@cloudflare/think";
import { defaultContextOverflowClassifier } from "@cloudflare/think";
import { callable } from "agents";
import { type ToolSet, tool } from "ai";
import type { IntegrationApproval } from "./domain/actions";
import { createComputerBrowserTools } from "./runtime/computer-browser";
import { createComputerDesktopTools } from "./runtime/computer-desktop";
import { createComputerFileTools } from "./runtime/computer-files";
import { COMPUTER_ACTIONS } from "./runtime/computer-permissions";
import type { ComputerControlPayload, ComputerLeasePayload } from "./runtime/computer-types";
import { createKnowledgeTools } from "./runtime/knowledge-tools";
import type { LinuxProcessPollPayload } from "./runtime/managed-linux-process";
import { mcpOAuthCallbackResponse, type TeammateConnection } from "./runtime/mcp";
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
import { checkpointStep, DEFAULT_TURN_STEPS, repeatedStepResult } from "./runtime/turn-supervision";
import { GLM_PRIMARY_MODEL_ID, type TeammateChatSubmission } from "./runtime/types";
import { migrateTeammateWork, type WorkResumePayload } from "./runtime/work";
import { TeammateProductRuntime } from "./teammate-product";
import { FIRST_MESSAGE_STOPPED_KEY } from "./teammate-runtime";
import type { Sql } from "./workspace/sql";

export class HQBotTeammate extends TeammateProductRuntime {
  maxSteps = DEFAULT_TURN_STEPS;
  contextOverflow = {
    reactive: true,
    maxRetries: 1,
    proactive: { maxInputTokens: 24_000, headroom: 0.8, maxCompactions: 2 }
  };
  classifyChatError = defaultContextOverflowClassifier;
  private turnStepLimit = DEFAULT_TURN_STEPS;

  chatStreamStallTimeoutMs = 120_000;
  workspaceBash = false;
  includeMcpTools = false;
  waitForMcpConnections = { timeout: 10_000 };
  storeMessages = false;
  storeTools = false;

  getModel = () => this.modelFor(GLM_PRIMARY_MODEL_ID);

  getTools(): ToolSet {
    return Object.fromEntries(
      Object.entries(this.runtimeTools()).filter(([name]) => !COMPUTER_ACTIONS.has(name))
    );
  }
  getActions() {
    return this.computerPermissions.actions(this.runtimeTools());
  }

  private runtimeTools(): ToolSet {
    const tools: ToolSet = {
      ...this.productTools(),
      ...createKnowledgeTools(this.workspaceAgent, this.name, (query) =>
        this.session.search(query, { limit: 15 })
      ),
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
    await this.assertProductTurnAllowed();
    const activeWork = this.tasks.active();
    if (
      this.activeTurnMetadata?.source === "active-task" &&
      (!activeWork ||
        this.activeTurnMetadata.taskId !== activeWork.taskId ||
        this.activeTurnMetadata.generation !== activeWork.generation ||
        activeWork.state !== "running")
    )
      throw new Error("This task continuation is stale");
    const config = await prepareTeammateTurn({
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
    if (activeWork)
      config.instructions = `${config.instructions}\nSaved completion criteria: ${JSON.stringify(this.taskSupervision.criteria(activeWork.taskId))}`;
    this.turnStepLimit = config.maxSteps ?? DEFAULT_TURN_STEPS;
    return config;
  }

  async beforeStep(ctx: PrepareStepContext): Promise<StepConfig | undefined> {
    await this.assertProductTurnAllowed();
    if (repeatedStepResult(ctx)) {
      const work = this.tasks.active();
      if (work && !this.processes.active())
        await this.tasks.manage({
          action: "needs_user",
          goal: work.goal,
          checkpoint: `${work.checkpoint}\nThree identical tool results. Owner review is required before continuing.`
        });
      throw new Error(
        "Repeated tool calls made no progress. Review the last result before continuing."
      );
    }
    if (
      (await this.integrationRuntime.pending()).length ||
      (await this.listComputerApprovals()).length ||
      this.tasks.active()?.state === "uncertain"
    )
      return { toolChoice: "none" } as unknown as StepConfig;
    const checkpoint = checkpointStep(ctx, this.turnStepLimit);
    if (checkpoint && !this.processes.active()) return checkpoint;
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

  async onChatResponse(result: ChatResponseResult): Promise<void> {
    const pending = [
      ...(await this.integrationRuntime.pending()),
      ...(await this.listComputerApprovals())
    ];
    const work = this.tasks.active();
    if (pending.length && work?.state === "running" && !this.processes.active())
      await this.tasks.manage({
        action: "needs_user",
        goal: work.goal,
        checkpoint: `${work.checkpoint}\nWaiting for owner approval of the connected action.`
      });
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
    if (pending.length > 0) {
      await this.workspaceAgent.markInteraction(
        this.name,
        "Action needs approval",
        "needs_approval"
      );
    }
    await this.productResponse(result);
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
    await this.integrationRuntime.recover();
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
  listIntegrationApprovals(): Promise<IntegrationApproval[]> {
    return this.integrationRuntime.pending();
  }

  @callable()
  approveIntegrationAction(
    executionId: string,
    seq: number,
    inputHash: string
  ): Promise<ProxyToolOutput> {
    return this.integrationRuntime.approve(executionId, seq, inputHash);
  }

  @callable()
  rejectIntegrationAction(executionId: string, seq: number): Promise<boolean> {
    return this.integrationRuntime.reject(executionId, seq);
  }

  @callable()
  listActionHistory() {
    return this.integrationRuntime.history();
  }

  @callable()
  resolveUnknownAction(id: string, evidence: string, happened: boolean) {
    return this.integrationRuntime.resolveUnknown(id, evidence, happened);
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
