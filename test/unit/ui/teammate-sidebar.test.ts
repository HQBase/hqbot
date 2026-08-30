// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TeammateSidebar } from "../../../src/ui/components/teammate-sidebar";
import type { TeammateSummary } from "../../../src/ui/types";

function teammate(id: string, name: string, lastInteractedAt: string): TeammateSummary {
  return {
    brief: "",
    connection: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    dailyBudgetUsd: 1,
    description: "",
    hidden: false,
    id,
    lastInteractedAt,
    lastMessage: `${name} message`,
    modelId: null,
    name,
    pinned: false,
    status: "idle",
    title: "Research teammate",
    updatedAt: lastInteractedAt
  };
}

describe("TeammateSidebar", () => {
  it("shows teammates by latest interaction and has no Recent work section", () => {
    const html = renderToStaticMarkup(
      createElement(TeammateSidebar, {
        bots: [
          teammate("old", "Older teammate", "2026-08-28T12:00:00.000Z"),
          teammate("new", "Latest teammate", "2026-08-30T12:00:00.000Z")
        ],
        onCreate: vi.fn(),
        onSelect: vi.fn(),
        selectedId: null
      })
    );

    expect(html.indexOf("Latest teammate")).toBeLessThan(html.indexOf("Older teammate"));
    expect(html).not.toContain("Recent work");
    expect(html).toContain("Teammates");
  });
});
