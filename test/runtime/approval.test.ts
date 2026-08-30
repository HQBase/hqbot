import { describe, expect, it, vi } from "vitest";

import {
  executeApprovedReply,
  findReplyApproval,
  replyApprovalOutcome,
  resolveReplyApprovalLifecycle
} from "../../src/runtime/approval";

function pending(input: unknown = { taskId: "task-1", draft: "Useful reply" }) {
  return {
    executionId: "action-pause:approval-1",
    source: "action",
    descriptor: {
      action: "send_hqbase_reply",
      input
    }
  };
}

describe("reply approvals", () => {
  it("finds only the HQBase reply action for the requested task", () => {
    const approvals = [
      { ...pending(), descriptor: { action: "other_action", input: pending().descriptor.input } },
      pending()
    ];

    expect(findReplyApproval(approvals, { taskId: "task-1" })).toEqual({
      executionId: "action-pause:approval-1",
      taskId: "task-1",
      draft: "Useful reply"
    });
    expect(findReplyApproval(approvals, { taskId: "other-task" })).toBeNull();
    expect(findReplyApproval(approvals, { executionId: "other-execution" })).toBeNull();
  });

  it("ignores incomplete or malformed approval descriptors", () => {
    expect(findReplyApproval([pending({ taskId: "task-1" })], { taskId: "task-1" })).toBeNull();
    expect(findReplyApproval([pending({ taskId: "", draft: "Reply" })], {})).toBeNull();
    expect(findReplyApproval([{ ...pending(), source: "codemode" }], {})).toBeNull();
  });

  it("classifies successful, rejected, failed, and raced resolutions", () => {
    expect(replyApprovalOutcome({ messageId: "reply-1", duplicate: false }, true)).toBe("approved");
    expect(replyApprovalOutcome({ status: "rejected" }, false)).toBe("rejected");
    expect(replyApprovalOutcome({ status: "error", error: "HQBase is unavailable" }, true)).toBe(
      "failed"
    );
    expect(
      replyApprovalOutcome(
        { status: "error", error: "Execution is no longer pending — it was resolved elsewhere." },
        true
      )
    ).toBe("conflict");
  });

  it("records a native rejection after Think consumes the durable pause", async () => {
    const recordRejection = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const resolve = vi.fn(async () => ({ status: "rejected" }));

    await expect(
      resolveReplyApprovalLifecycle({
        executionId: "action-pause:approval-1",
        approved: false,
        pending: Promise.resolve([pending()]),
        resolve,
        recordRejection,
        fail
      })
    ).resolves.toEqual({ status: "rejected" });
    expect(recordRejection).toHaveBeenCalledWith("task-1");
    expect(fail).not.toHaveBeenCalled();
  });

  it("records approval once inside the claimed action before it sends", async () => {
    const calls: string[] = [];
    const recordDecision = vi.fn(async () => {
      calls.push("approved");
    });
    const send = vi.fn(async () => {
      calls.push("sent");
      return { messageId: "reply-1", duplicate: false };
    });

    await executeApprovedReply({ taskId: "task-1", recordDecision, send });

    expect(calls).toEqual(["approved", "sent"]);
    expect(recordDecision).toHaveBeenCalledOnce();
  });

  it("fails the task when an approved action is consumed but cannot run", async () => {
    const recordRejection = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);

    await resolveReplyApprovalLifecycle({
      executionId: "action-pause:approval-1",
      approved: true,
      pending: Promise.resolve([pending()]),
      resolve: async () => ({ status: "error", error: "HQBase is unavailable" }),
      recordRejection,
      fail
    });
    expect(fail).toHaveBeenCalledWith("task-1");
    expect(recordRejection).not.toHaveBeenCalled();
  });

  it("does not change workspace state for a raced resolution", async () => {
    const recordRejection = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);

    await resolveReplyApprovalLifecycle({
      executionId: "action-pause:approval-1",
      approved: true,
      pending: Promise.resolve([pending()]),
      resolve: async () => ({ status: "error", error: "Execution is no longer pending" }),
      recordRejection,
      fail
    });
    expect(recordRejection).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });
});
