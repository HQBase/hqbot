import type { TaskCoordinator } from "./task-coordinator";

// Metadata comes from Think's server-stamped user message, never from model text.
export async function resumeOwnerTask(
  tasks: TaskCoordinator,
  metadata: Record<string, unknown> | undefined,
  blocked: () => Promise<boolean>
): Promise<void> {
  if (!metadata || !["computer-decision", "integration-result"].includes(String(metadata.source)))
    return;
  await tasks.run(async () => {
    const work = tasks.current();
    if (
      work?.state !== "needs_user" ||
      work.lastError ||
      metadata.taskId !== work.taskId ||
      metadata.generation !== work.generation ||
      (await blocked())
    )
      return;
    const resumed = tasks.transition(work, {
      ...work,
      state: "running",
      wakeAt: null,
      scheduleId: null,
      // Computer approvals use Think's native continuation, not the old submission.
      submissionId:
        metadata.source === "integration-result" && typeof metadata.integrationResultId === "string"
          ? metadata.integrationResultId
          : null,
      updatedAt: new Date().toISOString()
    });
    if (resumed) await tasks.syncProjection(resumed);
  });
}
