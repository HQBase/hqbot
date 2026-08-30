// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BotRoutine, BotTeammate } from "../../../src/domain/types";
import { ResourcesPanel } from "../../../src/ui/components/details/resources-panel";

function teammate(): BotTeammate {
  return {
    brief: "",
    connection: null,
    createdAt: "2026-08-30T12:00:00.000Z",
    dailyBudgetUsd: 1,
    description: "",
    hidden: false,
    id: "bot-1",
    lastInteractedAt: null,
    lastMessage: null,
    modelId: null,
    name: "Research",
    pinned: false,
    status: "idle",
    title: "Research teammate",
    updatedAt: "2026-08-30T12:00:00.000Z"
  };
}

const routine: BotRoutine = {
  active: true,
  botId: "bot-1",
  createdAt: "2026-08-30T12:00:00.000Z",
  id: "routine-1",
  intervalMinutes: 60,
  name: "Daily brief",
  nextRunAt: "2026-08-30T13:00:00.000Z",
  prompt: "Summarize the news",
  updatedAt: "2026-08-30T12:00:00.000Z"
};

function render(routines: BotRoutine[] = []): string {
  return renderToStaticMarkup(
    createElement(ResourcesPanel, {
      bot: teammate(),
      files: [],
      memories: [],
      onDeleteRoutine: vi.fn(),
      onNewRoutine: vi.fn(),
      onNewSkill: vi.fn(),
      onSetRoutineActive: vi.fn(),
      onUseSkill: vi.fn(),
      routines,
      skills: []
    })
  );
}

describe("ResourcesPanel", () => {
  it("does not add an HQBase section to teammate details", () => {
    expect(render()).not.toContain("HQBase");
    expect(render()).not.toContain("Manage");
  });

  it("offers pause and delete controls for a routine", () => {
    const html = render([routine]);

    expect(html).toContain("Daily brief");
    expect(html).toContain('aria-label="Pause Daily brief"');
    expect(html).toContain('aria-label="Delete Daily brief"');
  });

  it("offers resume for a paused routine", () => {
    expect(render([{ ...routine, active: false }])).toContain('aria-label="Resume Daily brief"');
  });
});
