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
  const current = host.current();
  if (
    current?.taskId !== work.taskId ||
    current.generation !== work.generation ||
    current.state !== work.state ||
    current.updatedAt !== work.updatedAt
  )
    return;
  await options.workspaceAgent.projectTask({ botId: options.botId, work });
}
