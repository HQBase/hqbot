import type { ThinkSubmissionInspection } from "@cloudflare/think";

import type { TaskCoordinatorOptions } from "./task-coordinator";
import { type ActiveWork, isTerminalWork, type WorkResumePayload } from "./work";

interface TaskRecoveryHost {
  cancel(reason: string): Promise<void>;
  current(): ActiveWork | null;
  settleSubmission(submission: ThinkSubmissionInspection): Promise<void>;
  syncProjection(work: ActiveWork): Promise<void>;
  transition(previous: ActiveWork | null, next: ActiveWork): ActiveWork | null;
}

export class TaskRecovery {
  constructor(
    private readonly options: TaskCoordinatorOptions,
    private readonly host: TaskRecoveryHost
  ) {}

  async resume(payload: WorkResumePayload): Promise<void> {
    const work = this.options.store.claimResume(payload);
    if (!work) return;
    try {
      if (!(await this.options.teammateIsActive())) {
        await this.host.cancel("The teammate is not active");
        return;
      }
      await this.host.syncProjection(work);
      const submissionId = `task:${work.taskId}:turn:${work.generation}`;
      const result = await this.options.submitResume(work, submissionId);
      const saved = this.options.store.setSubmission(
        work.taskId,
        work.generation,
        result.submissionId
      );
      if (saved) {
        await this.options.workspaceAgent.setTaskSubmission(saved.taskId, result.submissionId);
      }
      if (!result.accepted) await this.reconcileSubmission(saved ?? work, result.submissionId);
    } catch (cause) {
      const current = this.host.current();
      if (
        current?.taskId !== work.taskId ||
        current.generation !== work.generation ||
        current.state !== "running"
      )
        throw cause;
      try {
        await this.rearm(current);
      } catch {
        const uncertain = this.host.transition(current, {
          ...current,
          state: "uncertain",
          lastError: "The task turn could not be submitted or scheduled",
          updatedAt: new Date().toISOString()
        });
        if (!uncertain) throw cause;
        await this.host.syncProjection(uncertain).catch(() => undefined);
        await this.options.workspaceAgent.markInteraction(
          this.options.botId,
          "Task continuation needs attention",
          "idle"
        );
      }
    }
  }

  async reconcile(): Promise<void> {
    const current = this.host.current();
    if (!current) return;
    await this.host.syncProjection(current).catch(() => undefined);
    const process = this.options.getProcess();
    if (
      current.state === "waiting" &&
      process?.taskId === current.taskId &&
      process.generation === current.generation &&
      (process.active || process.hasResult)
    )
      return;
    if (
      isTerminalWork(current.state) ||
      current.state === "needs_user" ||
      current.state === "uncertain"
    )
      return;
    if (current.state === "scheduled" || current.state === "waiting") {
      if (current.scheduleId && (await this.options.getSchedule(current.scheduleId))) return;
      await this.rearm(current);
      return;
    }
    if (!current.submissionId) {
      await this.rearm(current);
      return;
    }
    await this.reconcileSubmission(current, current.submissionId);
  }

  private async rearm(work: ActiveWork): Promise<void> {
    const wakeAt = work.wakeAt ? new Date(work.wakeAt) : new Date(Date.now() + 1_000);
    const when = wakeAt.getTime() > Date.now() ? wakeAt : new Date(Date.now() + 1_000);
    const payload: WorkResumePayload = {
      taskId: work.taskId,
      generation: work.generation,
      goal: work.goal,
      checkpoint: work.checkpoint,
      createdAt: work.createdAt,
      predecessorGeneration: work.generation,
      predecessorTaskId: work.taskId,
      transitionAt: work.updatedAt
    };
    const schedule = await this.options.scheduleResume(when, payload);
    const current = this.host.current();
    if (
      !current ||
      current.taskId !== work.taskId ||
      current.generation !== work.generation ||
      !["running", "scheduled", "waiting"].includes(current.state)
    ) {
      await this.options.cancelSchedule(schedule.id).catch(() => false);
      return;
    }
    this.options.store.put({
      ...current,
      state: current.state === "waiting" ? "waiting" : "scheduled",
      wakeAt: when.toISOString(),
      scheduleId: schedule.id,
      updatedAt: new Date().toISOString()
    });
  }

  private async reconcileSubmission(work: ActiveWork, submissionId: string): Promise<void> {
    const submission = await this.options.inspectSubmission(submissionId);
    if (!submission) {
      await this.rearm(work);
      return;
    }
    if (submission.status === "pending" || submission.status === "running") return;
    await this.host.settleSubmission(submission);
  }
}
