import type { ThinkSubmissionInspection } from "@cloudflare/think";

import type { TaskManagementInput } from "./task-management";
import { TaskRecovery } from "./task-recovery";
import type { WorkspaceAgentRpc } from "./types";
import type { ActiveWork, TeammateWorkStore, WorkResumePayload } from "./work";

export interface ProcessState {
  active: boolean;
  generation: number;
  hasResult: boolean;
  taskId: string;
}

export interface TaskCoordinatorOptions {
  botId: string;
  cancelProcess: (
    current: ActiveWork | null,
    cancelled: ActiveWork | null
  ) => Promise<ActiveWork | null>;
  cancelSchedule: (id: string) => Promise<unknown>;
  cancelSubmission: (id: string, reason: string) => Promise<unknown>;
  getProcess: () => ProcessState | null;
  getSchedule: (id: string) => Promise<unknown>;
  inspectSubmission: (id: string) => Promise<ThinkSubmissionInspection | null>;
  latestAssistantText: () => string;
  scheduleResume: (when: Date, payload: WorkResumePayload) => Promise<{ id: string }>;
  store: TeammateWorkStore;
  submitResume: (
    work: ActiveWork,
    submissionId: string
  ) => Promise<{ accepted: boolean; submissionId: string }>;
  teammateIsActive: () => Promise<boolean>;
  workspaceAgent: WorkspaceAgentRpc;
}

export class TaskCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private recovery: TaskRecovery | null = null;

  constructor(private readonly options: TaskCoordinatorOptions) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  active(): ActiveWork | null {
    return this.options.store.active();
  }

  current(): ActiveWork | null {
    return this.options.store.current();
  }

  transition(previous: ActiveWork | null, next: ActiveWork): ActiveWork | null {
    return this.options.store.transition(previous, next);
  }

  assertManageAvailable(): void {
    if (this.options.getProcess()?.active) {
      throw new Error("Bash already manages this task and its next turn");
    }
  }

  async manage(input: TaskManagementInput) {
    this.assertManageAvailable();
    const current = this.active();
    const predecessor = this.current();
    if (input.action === "done") {
      if (!current) return { active: false, state: "idle" as const };
      const work = await this.finish(current, "done", input.result);
      return { active: false, state: work.state, taskId: work.taskId };
    }

    const goal = input.goal ?? current?.goal;
    if (!goal) throw new Error("goal is required when a task starts");
    const transitionAt = new Date().toISOString();
    const taskId = current?.taskId ?? crypto.randomUUID();
    const generation = (current?.generation ?? 0) + 1;
    const createdAt = current?.createdAt ?? transitionAt;
    if (input.action === "needs_user") {
      const work = this.transition(predecessor, {
        taskId,
        goal,
        checkpoint: input.checkpoint,
        state: "needs_user",
        generation,
        wakeAt: null,
        scheduleId: null,
        submissionId: current?.submissionId ?? null,
        lastError: null,
        createdAt,
        updatedAt: transitionAt
      });
      if (!work) throw new Error("The task changed before its checkpoint was saved");
      if (current?.scheduleId)
        await this.options.cancelSchedule(current.scheduleId).catch(() => false);
      await this.syncProjection(work);
      await this.options.workspaceAgent.markInteraction(
        this.options.botId,
        "Waiting for your reply",
        "idle"
      );
      return { active: true, state: work.state, taskId: work.taskId };
    }

    return this.scheduleWork({
      checkpoint: input.checkpoint,
      current,
      goal,
      predecessor,
      state: "scheduled",
      wakeAt: new Date(Date.now() + 1_000)
    });
  }

  async scheduleOnce(input: { checkpoint: string; goal: string; wakeAt: string }) {
    this.assertManageAvailable();
    return this.scheduleWork({
      ...input,
      current: this.active(),
      predecessor: this.current(),
      state: "waiting",
      wakeAt: new Date(input.wakeAt)
    });
  }

  private async scheduleWork(input: {
    checkpoint: string;
    current: ActiveWork | null;
    goal: string;
    predecessor: ActiveWork | null;
    state: "scheduled" | "waiting";
    wakeAt: Date;
  }) {
    const { checkpoint, current, goal, predecessor, state, wakeAt } = input;
    if (!Number.isFinite(wakeAt.getTime()) || wakeAt.getTime() <= Date.now()) {
      throw new Error("wakeAt must be a future ISO date and time");
    }
    const transitionAt = new Date().toISOString();
    const taskId = current?.taskId ?? crypto.randomUUID();
    const generation = (current?.generation ?? 0) + 1;
    const createdAt = current?.createdAt ?? transitionAt;
    const payload: WorkResumePayload = {
      taskId,
      generation,
      goal,
      checkpoint,
      createdAt,
      predecessorGeneration: predecessor?.generation ?? null,
      predecessorTaskId: predecessor?.taskId ?? null,
      transitionAt
    };
    const schedule = await this.options.scheduleResume(wakeAt, payload);
    const work = this.transition(predecessor, {
      taskId,
      goal,
      checkpoint,
      state,
      generation,
      wakeAt: wakeAt.toISOString(),
      scheduleId: schedule.id,
      submissionId: current?.submissionId ?? null,
      lastError: null,
      createdAt,
      updatedAt: transitionAt
    });
    if (!work) {
      await this.options.cancelSchedule(schedule.id).catch(() => false);
      throw new Error("The task changed before its continuation was saved");
    }
    if (current?.scheduleId && current.scheduleId !== schedule.id) {
      await this.options.cancelSchedule(current.scheduleId).catch(() => false);
    }
    await this.syncProjection(work);
    return { active: true, state: work.state, taskId: work.taskId, wakeAt: work.wakeAt };
  }

  async resume(payload: WorkResumePayload): Promise<void> {
    await this.taskRecovery().resume(payload);
  }

  async reconcile(): Promise<void> {
    await this.taskRecovery().reconcile();
  }

  async settleTurn(
    taskId: unknown,
    generation: unknown,
    status: "completed" | "error" | "aborted" | "skipped",
    text: string,
    error?: string
  ): Promise<void> {
    const current = this.current();
    if (
      !current ||
      taskId !== current.taskId ||
      generation !== current.generation ||
      current.state !== "running"
    )
      return;
    if (status === "completed") await this.settleCompleted(current, text);
    else if (status === "error") await this.finish(current, "failed", error ?? "The task failed");
    else await this.finish(current, "cancelled", error ?? "The task stopped");
  }

  async settleSubmission(submission: ThinkSubmissionInspection): Promise<void> {
    if (submission.status === "pending" || submission.status === "running") return;
    const current = this.current();
    if (
      current?.state !== "running" ||
      current.submissionId !== submission.submissionId ||
      current.taskId !== submission.metadata?.taskId ||
      current.generation !== submission.metadata?.generation
    )
      return;
    await this.settleTurn(
      current.taskId,
      current.generation,
      submission.status,
      this.options.latestAssistantText(),
      submission.error
    );
  }

  async continueFrom(current: ActiveWork, checkpoint: string): Promise<ActiveWork> {
    const transitionAt = new Date().toISOString();
    const payload: WorkResumePayload = {
      taskId: current.taskId,
      generation: current.generation + 1,
      goal: current.goal,
      checkpoint: checkpoint.slice(0, 20_000),
      createdAt: current.createdAt,
      predecessorGeneration: current.generation,
      predecessorTaskId: current.taskId,
      transitionAt
    };
    const next = this.transition(current, {
      ...current,
      checkpoint: payload.checkpoint,
      state: "scheduled",
      generation: payload.generation,
      wakeAt: null,
      scheduleId: null,
      submissionId: null,
      lastError: null,
      updatedAt: transitionAt
    });
    if (!next) return this.current() ?? current;
    await this.syncProjection(next).catch(() => undefined);
    await this.taskRecovery().resume(payload);
    return this.current() ?? next;
  }

  async finish(
    current: ActiveWork,
    state: "done" | "failed" | "cancelled",
    message: string
  ): Promise<ActiveWork> {
    const work = this.transition(current, {
      ...current,
      checkpoint: state === "done" ? message : current.checkpoint,
      state,
      generation: current.generation + 1,
      wakeAt: null,
      scheduleId: null,
      lastError: state === "failed" ? message.slice(0, 500) : null,
      updatedAt: new Date().toISOString()
    });
    if (!work) return this.current() ?? current;
    if (current.scheduleId)
      await this.options.cancelSchedule(current.scheduleId).catch(() => false);
    await this.syncProjection(work);
    return work;
  }

  async markExternalEffectUncertain(): Promise<void> {
    const current = this.active();
    if (!current || current.state === "uncertain") return;
    const uncertain = this.transition(current, {
      ...current,
      state: "uncertain",
      lastError: "A connected-service action has an unknown outcome",
      updatedAt: new Date().toISOString()
    });
    if (!uncertain) return;
    if (current.scheduleId)
      await this.options.cancelSchedule(current.scheduleId).catch(() => false);
    await this.syncProjection(uncertain).catch(() => undefined);
    await this.options.workspaceAgent.markInteraction(
      this.options.botId,
      "Connected-service action needs review",
      "idle"
    );
  }

  async markRecoveryFailure(): Promise<void> {
    const current = this.active();
    if (current && current.state !== "uncertain") {
      const uncertain = this.transition(current, {
        ...current,
        state: "uncertain",
        lastError: "Durable task recovery needs attention",
        updatedAt: new Date().toISOString()
      });
      if (!uncertain) throw new Error("The failed recovery state could not be saved");
      await this.syncProjection(uncertain).catch(() => undefined);
    }
    await this.options.workspaceAgent.markInteraction(
      this.options.botId,
      "Task recovery needs attention",
      "idle"
    );
  }

  async cancel(reason = "The owner stopped this task"): Promise<void> {
    await this.cancelNow(reason);
  }

  private async cancelNow(reason: string): Promise<void> {
    const current = this.active();
    if (!current) {
      await this.options.cancelProcess(null, null);
      return;
    }
    const next: ActiveWork = {
      ...current,
      state: "cancelled",
      generation: current.generation + 1,
      wakeAt: null,
      scheduleId: null,
      lastError: null,
      updatedAt: new Date().toISOString()
    };
    let processError: unknown;
    let work: ActiveWork | null;
    try {
      work = await this.options.cancelProcess(current, next);
    } catch (cause) {
      processError = cause;
      const stored = this.current();
      work = stored?.taskId === current.taskId && stored.state === "cancelled" ? stored : null;
    }
    if (!work) return;
    if (current.scheduleId)
      await this.options.cancelSchedule(current.scheduleId).catch(() => false);
    if (current.submissionId)
      await this.options.cancelSubmission(current.submissionId, reason).catch(() => undefined);
    await this.syncProjection(work);
    if (processError) throw processError;
  }

  async syncProjection(work: ActiveWork): Promise<void> {
    const workspace = this.options.workspaceAgent;
    await workspace.startTask(work.taskId, this.options.botId, work.goal);
    await workspace.syncTaskState(work.taskId, work.state, work.wakeAt);
    if (work.submissionId) await workspace.setTaskSubmission(work.taskId, work.submissionId);
    if (work.state === "done") await workspace.completeTask(work.taskId, work.checkpoint);
    if (work.state === "failed")
      await workspace.failTask(work.taskId, work.lastError ?? "The task failed");
    if (work.state === "cancelled") await workspace.cancelTask(work.taskId);
  }

  private async settleCompleted(current: ActiveWork, text: string): Promise<ActiveWork> {
    const result = text.trim();
    return result
      ? this.finish(current, "done", result)
      : this.continueFrom(current, current.checkpoint);
  }

  private taskRecovery(): TaskRecovery {
    this.recovery ??= new TaskRecovery(this.options, this);
    return this.recovery;
  }
}
