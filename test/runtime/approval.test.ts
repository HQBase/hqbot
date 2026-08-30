import { describe, expect, it, vi } from "vitest";

import {
  clearPendingReplyApprovals,
  executeApprovedReply,
  findReplyApproval,
  replyApprovalOutcome,
  resolveReplyApprovalLifecycle,
  STALE_REPLY_APPROVAL_ERROR
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
      replyApprovalOutcome({ error: { name: "Error", message: STALE_REPLY_APPROVAL_ERROR } }, true)
    ).toBe("stale");
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

  it("claims the exact draft before it sends", async () => {
    const calls: string[] = [];
    const claim = vi.fn(async () => {
      calls.push("claimed");
      return true;
    });
    const send = vi.fn(async () => {
      calls.push("sent");
      return { messageId: "reply-1", duplicate: false };
    });

    await executeApprovedReply({
      taskId: "task-1",
      draft: "Useful reply",
      claim,
      send
    });

    expect(calls).toEqual(["claimed", "sent"]);
    expect(claim).toHaveBeenCalledWith("task-1", "Useful reply");
  });

  it("does not send after a canceled task loses the workspace claim", async () => {
    const send = vi.fn(async () => ({ messageId: "reply-1", duplicate: false }));

    await expect(
      executeApprovedReply({
        taskId: "task-1",
        draft: "Stale reply",
        claim: async () => false,
        send
      })
    ).rejects.toThrow(STALE_REPLY_APPROVAL_ERROR);
    expect(send).not.toHaveBeenCalled();
  });

  it("clears every pending Think reply approval for a stopped task", async () => {
    const reject = vi.fn(async () => ({ status: "rejected" }));
    const second = { ...pending(), executionId: "action-pause:approval-2" };
    const other = pending({ taskId: "task-2", draft: "Other reply" });

    await expect(
      clearPendingReplyApprovals({
        taskId: "task-1",
        pending: Promise.resolve([pending(), second, other]),
        reject
      })
    ).resolves.toBe(2);
    expect(reject).toHaveBeenNthCalledWith(1, "action-pause:approval-1");
    expect(reject).toHaveBeenNthCalledWith(2, "action-pause:approval-2");
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

  it("does not fail a task when a stale approval loses the workspace claim", async () => {
    const recordRejection = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);

    await resolveReplyApprovalLifecycle({
      executionId: "action-pause:approval-1",
      approved: true,
      pending: Promise.resolve([pending()]),
      resolve: async () => ({
        error: { name: "Error", message: STALE_REPLY_APPROVAL_ERROR }
      }),
      recordRejection,
      fail
    });
    expect(recordRejection).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });
});
