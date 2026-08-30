// @vitest-environment happy-dom

import type { PendingApproval } from "@cloudflare/think";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApprovalCard } from "../../../src/ui/components/chat/approval-card";
import { replyDraft } from "../../../src/ui/components/realtime-conversation";
import { renderComponent } from "./render.tsx";

describe("ApprovalCard", () => {
  it("shows the exact HQBase reply before the owner approves it", async () => {
    const expected = "Hello Sam,\n\nHere is the researched answer & source.\n\nBest,\nHQBot";
    const approval: PendingApproval = {
      executionId: "approval-1",
      source: "action",
      descriptor: {
        action: "send_hqbase_reply",
        input: { draft: expected, taskId: "task-1" },
        kind: "durable-pause",
        permissions: ["hqbase:reply"],
        requestId: "request-1",
        risk: "high",
        summary: "Send this HQBase reply",
        toolCallId: "tool-1"
      }
    };
    const draft = replyDraft(approval);
    const view = await renderComponent(
      createElement(ApprovalCard, {
        draft,
        pending: false,
        onApprove: vi.fn(),
        onDeny: vi.fn()
      })
    );

    expect(view.container.querySelector('[aria-label="HQBase reply draft"]')?.textContent).toBe(
      expected
    );
    await view.unmount();
  });
});
