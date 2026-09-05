import type { TaskCoordinator, TaskCoordinatorOptions } from "./task-coordinator";
import type { ActiveWork } from "./work";

export async function syncTaskProjection(
  host: TaskCoordinator,
  options: TaskCoordinatorOptions,
  work: ActiveWork
): Promise<void> {
  const stalled = options.supervisor.observe(work);
  if (stalled) {
    const paused = host.transition(work, {
      ...work,
      state: "needs_user",
      lastError: stalled,
      wakeAt: null,
      scheduleId: null
    });
    if (work.scheduleId) await options.cancelSchedule(work.scheduleId).catch(() => false);
    if (paused) work = paused;
  }
  const workspace = options.workspaceAgent;
  await workspace.startTask(work.taskId, options.botId, work.goal);
  await workspace.syncTaskState(work.taskId, work.state, work.wakeAt);
  if (work.submissionId) await workspace.setTaskSubmission(work.taskId, work.submissionId);
  if (work.state === "done") await workspace.completeTask(work.taskId, work.checkpoint);
  if (work.state === "failed")
    await workspace.failTask(work.taskId, work.lastError ?? "The task failed");
  if (work.state === "cancelled") await workspace.cancelTask(work.taskId);
}
