// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BotFile, BotRoutine, BotTask, BotTeammate } from "../../../src/domain/types";
import { ResourcesPanel } from "../../../src/ui/components/details/resources-panel";

function teammate(): BotTeammate {
  return {
    brief: "",
    createdAt: "2026-08-30T12:00:00.000Z",
    dailyBudgetUsd: 1,
    description: "",
    hidden: false,
    id: "bot-1",
    lastInteractedAt: null,
    lastMessage: null,
    maxSteps: null,
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

const file: BotFile = {
  botId: "bot-1",
  contentType: "image/jpeg",
  createdAt: "2026-08-30T12:05:00.000Z",
  id: "file-1",
  key: "files/bot-1/file-1/result.jpg",
  name: "result.jpg",
  size: 1024,
  taskId: null
};

function render(
  routines: BotRoutine[] = [],
  files: BotFile[] = [],
  task: BotTask | null = null
): string {
  return renderToStaticMarkup(
    createElement(ResourcesPanel, {
      bot: teammate(),
      files,
      memories: [],
      onDeleteRoutine: vi.fn(),
      onNewRoutine: vi.fn(),
      onNewSkill: vi.fn(),
      onSetRoutineActive: vi.fn(),
      onStopTask: vi.fn(),
      onUseSkill: vi.fn(),
      routines,
      skills: [],
      task
    })
  );
}

describe("ResourcesPanel", () => {
  it("does not add a provider-specific section to teammate details", () => {
    expect(render()).not.toContain("Mailbox");
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

  it("formats a one-minute routine in the singular", () => {
    expect(render([{ ...routine, intervalMinutes: 1 }])).toContain("Every 1 minute");
  });

  it("links each durable file to its bot-scoped content route", () => {
    const html = render([], [file]);

    expect(html).toContain("result.jpg");
    expect(html).toContain('href="/api/bots/bot-1/files/file-1"');
    expect(html).toContain('target="_blank"');
  });

  it("shows a one-time waiting task with a cancel action", () => {
    const task: BotTask = {
      botId: "bot-1",
      createdAt: "2026-08-30T12:00:00.000Z",
      error: null,
      id: "task-1",
      prompt: "Remind me to call Alex",
      result: null,
      source: "chat",
      status: "working",
      submissionId: null,
      updatedAt: "2026-08-30T12:00:00.000Z",
      wakeAt: "2026-08-30T13:00:00.000Z",
      workState: "waiting"
    };

    const html = render([], [], task);
    expect(html).toContain("Scheduled");
    expect(html).toContain("Remind me to call Alex");
    expect(html).toContain('aria-label="Cancel scheduled task"');
  });
});
