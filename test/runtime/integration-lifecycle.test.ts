import type { PendingAction } from "@cloudflare/codemode";
import { describe, expect, it, vi } from "vitest";

import {
  integrationApprovalStatus,
  rejectPendingIntegrationActions
} from "../../src/runtime/integration-lifecycle";

function action(executionId: string, connector: string, seq: number): PendingAction {
  return { args: {}, connector, executionId, method: "run", seq };
}

describe("connected-tool lifecycle", () => {
  it("rejects every pending action during stop or archive", async () => {
    const pending = vi.fn(async () => [action("one", "mcp_docs", 1), action("two", "mcp_git", 2)]);
    const reject = vi.fn(async () => true);

    expect(await rejectPendingIntegrationActions({ pending, reject })).toBe(2);
    expect(reject).toHaveBeenCalledWith({ executionId: "one", seq: 1 });
    expect(reject).toHaveBeenCalledWith({ executionId: "two", seq: 2 });
  });

  it("rejects only the disconnected server's pending action", async () => {
    const pending = vi.fn(async () => [action("one", "mcp_docs", 1), action("two", "mcp_git", 2)]);
    const reject = vi.fn(async () => true);

    expect(await rejectPendingIntegrationActions({ pending, reject }, "mcp_docs")).toBe(1);
    expect(reject).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledWith({ executionId: "one", seq: 1 });
  });

  it("keeps approval status while another action is pending", async () => {
    expect(
      await integrationApprovalStatus({ pending: async () => [action("two", "mcp_git", 2)] })
    ).toBe("needs_approval");
    expect(await integrationApprovalStatus({ pending: async () => [] })).toBe("idle");
  });
});
