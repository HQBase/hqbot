import { describe, expect, it, vi } from "vitest";

import { suspendTeammateWork } from "../../src/runtime/suspension";

describe("archived teammate suspension", () => {
  it("cancels durable and queued work before schedules reconcile", async () => {
    const events: string[] = [];
    const host = {
      cancelActiveTask: vi.fn(async (reason: string) => {
        events.push(`task:${reason}`);
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

    await suspendTeammateWork(host, "The owner stopped this teammate");

    expect(events).toEqual([
      "task:The owner stopped this teammate",
      "submission:submission-1",
      "submission:submission-2",
      "reconcile"
    ]);
    expect(host.listSubmissions).toHaveBeenCalledWith({ status: ["pending", "running"] });
    expect(host.cancelActiveTask).toHaveBeenCalledWith("The owner stopped this teammate");
    expect(host.cancelSubmission).toHaveBeenCalledWith(
      "submission-1",
      "The owner stopped this teammate"
    );
  });
});
