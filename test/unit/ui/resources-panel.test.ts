// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { ResourcesPanel } from "../../../src/ui/components/details/resources-panel";

function teammate(realtimeStatus: "connected" | "connecting" | "disconnected"): BotTeammate {
  return {
    brief: "",
    connection: {
      active: true,
      createdAt: "2026-08-30T12:00:00.000Z",
      id: "connection-1",
      lastEventAt: null,
      mailboxAddress: "hqbot@example.com",
      mailboxId: "mailbox-1",
      mailboxName: "HQBot",
      origin: "https://hqbase.example.com",
      provider: "hqbase",
      realtimeStatus
    },
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

function render(status: "connected" | "connecting" | "disconnected"): string {
  return renderToStaticMarkup(
    createElement(ResourcesPanel, {
      bot: teammate(status),
      files: [],
      memories: [],
      onConnect: vi.fn(),
      onNewRoutine: vi.fn(),
      onNewSkill: vi.fn(),
      onUseSkill: vi.fn(),
      routines: [],
      skills: []
    })
  );
}

describe("ResourcesPanel", () => {
  it("shows the real HQBase realtime state and a manage action", () => {
    expect(render("connected")).toContain("Connected");
    expect(render("connecting")).toContain("Connecting");
    expect(render("disconnected")).toContain("Reconnecting");
    expect(render("connected")).toContain("Manage");
    expect(render("connected")).not.toContain(">On<");
  });
});
