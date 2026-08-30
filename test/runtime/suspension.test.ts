import { describe, expect, it, vi } from "vitest";

import { suspendTeammateWork } from "../../src/runtime/suspension";

describe("archived teammate suspension", () => {
  it("cancels tracked and queued work before schedules reconcile", async () => {
    const events: string[] = [];
    const host = {
      cancelTask: vi.fn(async (taskId: string) => {
        events.push(`task:${taskId}`);
      }),
      listSubmissions: vi.fn(async () => [
        { createdAt: 1, status: "pending" as const, submissionId: "submission-1" },
        { createdAt: 2, status: "running" as const, submissionId: "submission-2" }
      ]),
      cancelSubmission: vi.fn(async (submissionId: string) => {
        events.push(`submission:${submissionId}`);
      }),
      internal_reconcileScheduledTasks: vi.fn(async () => {
        events.push("reconcile");
      })
    };

    await suspendTeammateWork(host, ["task-1", "task-2"], "The owner stopped this teammate");

    expect(events).toEqual([
      "task:task-1",
      "task:task-2",
      "submission:submission-1",
      "submission:submission-2",
      "reconcile"
    ]);
    expect(host.listSubmissions).toHaveBeenCalledWith({ status: ["pending", "running"] });
    expect(host.cancelSubmission).toHaveBeenCalledWith(
      "submission-1",
      "The owner stopped this teammate"
    );
  });
});
