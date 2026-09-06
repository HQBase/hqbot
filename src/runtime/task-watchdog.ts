import type { TaskCoordinator } from "./task-coordinator";
import type { ActiveWork } from "./work";

export const TASK_STALL_MS = 5 * 60_000;
export interface TaskHeartbeat {
  taskId: string;
  generation: number;
  at: number;
}
export interface TaskWatchdogHost {
  tasks: TaskCoordinator;
  blocked(): Promise<boolean>;
  stable(): Promise<boolean>;
  heartbeat(): Promise<TaskHeartbeat | undefined>;
  submissionPending(work: ActiveWork): Promise<boolean>;
  unresolvedEffect(): boolean;
  retry(taskId: string): boolean;
  abort(work: ActiveWork): void | Promise<void>;
  now(): number;
}

export async function checkTaskWatchdog(host: TaskWatchdogHost): Promise<void> {
  const work = host.tasks.current();
  if (!work || !["running", "scheduled"].includes(work.state) || (await host.blocked())) return;
  const stable = await host.stable();
  const matches = () => {
    const current = host.tasks.current();
    return (
      current?.taskId === work.taskId &&
      current.generation === work.generation &&
      current.state === work.state &&
      current.updatedAt === work.updatedAt
    );
  };
  if (!matches()) return;
  const pending = stable && work.state === "running" && (await host.submissionPending(work));
  if (!matches()) return;
  if (stable && !pending) {
    if (host.unresolvedEffect()) await host.tasks.markExternalEffectUncertain();
    else await host.tasks.run(() => host.tasks.reconcile());
    return;
  }
  const heartbeat = await host.heartbeat();
  const at =
    heartbeat?.taskId === work.taskId && heartbeat.generation === work.generation
      ? heartbeat.at
      : Date.parse(work.updatedAt);
  if (host.now() - at < TASK_STALL_MS || (await host.blocked())) return;
  if (!matches()) return;
  if (host.unresolvedEffect()) {
    await host.tasks.markExternalEffectUncertain();
    await host.abort(work);
    return;
  }
  // Fence the old turn before aborting: its response must not cancel the recovered task.
  const retry = host.retry(work.taskId);
  const next: ActiveWork = {
    ...work,
    generation: work.generation + 1,
    state: retry ? "scheduled" : "failed",
    submissionId: null,
    scheduleId: null,
    wakeAt: null,
    lastError: retry ? null : "The task stopped after three stalled-turn recovery attempts.",
    updatedAt: new Date(host.now()).toISOString()
  };
  const saved = host.tasks.transition(work, next);
  if (!saved) return;
  await host.abort(work);
  await host.tasks.syncProjection(saved);
  // Never hold the task queue while waiting for the aborted turn's response hook.
  if (!(await host.stable())) {
    if (host.tasks.current()?.generation === saved.generation)
      await host.tasks.markRecoveryFailure();
    return;
  }
  if (retry) await host.tasks.run(() => host.tasks.reconcile());
}
