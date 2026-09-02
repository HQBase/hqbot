import type { ListSubmissionsOptions, ThinkSubmissionInspection } from "@cloudflare/think";

interface SuspensionHost {
  cancelActiveTask(reason?: string): Promise<void>;
  listSubmissions(options?: ListSubmissionsOptions): Promise<ThinkSubmissionInspection[]>;
  cancelSubmission(submissionId: string, reason?: unknown): Promise<void>;
  internal_reconcileScheduledTasks(): Promise<void>;
}

export async function suspendTeammateWork(
  host: SuspensionHost,
  reason = "The owner archived this teammate"
): Promise<void> {
  await host.cancelActiveTask(reason);
  const submissions = await host.listSubmissions({ status: ["pending", "running"] });
  for (const submission of submissions) {
    await host.cancelSubmission(submission.submissionId, reason);
  }
  await host.internal_reconcileScheduledTasks();
}
