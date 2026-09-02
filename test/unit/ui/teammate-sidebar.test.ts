// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TeammateSidebar } from "../../../src/ui/components/teammate-sidebar";
import type { TeammateSummary } from "../../../src/ui/types";

function teammate(id: string, name: string, lastInteractedAt: string): TeammateSummary {
  return {
    brief: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    dailyBudgetUsd: 1,
    description: "",
    hidden: false,
    id,
    lastInteractedAt,
    lastMessage: `${name} message`,
    maxSteps: null,
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
        archivedBots: [],
        bots: [
          teammate("old", "Older teammate", "2026-08-28T12:00:00.000Z"),
          teammate("new", "Latest teammate", "2026-08-30T12:00:00.000Z")
        ],
        onCreate: vi.fn(),
        onLogout: vi.fn(),
        onSelect: vi.fn(),
        selectedId: null
      })
    );

    expect(html.indexOf("Latest teammate")).toBeLessThan(html.indexOf("Older teammate"));
    expect(html).not.toContain("Recent work");
    expect(html).toContain("Teammates");
    expect(html).toContain("Appearance");
    expect(html).toContain("Sign out");
  });

  it("keeps archived teammates in a separate restorable roster", () => {
    const archived = {
      ...teammate("archived", "Archived teammate", "2026-08-29T12:00:00.000Z"),
      hidden: true
    };
    const html = renderToStaticMarkup(
      createElement(TeammateSidebar, {
        archivedBots: [archived],
        bots: [teammate("active", "Active teammate", "2026-08-30T12:00:00.000Z")],
        onCreate: vi.fn(),
        onLogout: vi.fn(),
        onSelect: vi.fn(),
        selectedId: archived.id
      })
    );

    expect(html).toContain("Archived");
    expect(html).toContain("Archived teammate");
    expect(html).toContain('aria-current="page"');
  });

  it("does not use the teammate title as a recent message", () => {
    const connected = {
      ...teammate("connected", "Connected teammate", "2026-08-30T12:00:00.000Z"),
      lastMessage: null
    };
    const html = renderToStaticMarkup(
      createElement(TeammateSidebar, {
        archivedBots: [],
        bots: [connected],
        onCreate: vi.fn(),
        onLogout: vi.fn(),
        onSelect: vi.fn(),
        selectedId: null
      })
    );

    expect(html).toContain("New teammate");
    expect(html).not.toContain("Research teammate");
  });
});
