// @vitest-environment happy-dom

import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApprovalCard } from "../../../src/ui/components/chat/approval-card";
import { renderComponent } from "./render.tsx";

describe("ApprovalCard", () => {
  it("shows the exact connected-service action before approval", async () => {
    const expected = '{\n  "title": "Open an issue"\n}';
    const view = await renderComponent(
      createElement(ApprovalCard, {
        details: expected,
        pending: false,
        onApprove: vi.fn(),
        onDeny: vi.fn()
      })
    );

    expect(view.container.querySelector('[aria-label="Action details"]')?.textContent).toBe(
      expected
    );
    await view.unmount();
  });
});
