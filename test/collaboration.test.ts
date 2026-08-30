import { describe, expect, it } from "vitest";

import { mentionedTeammates } from "../src/domain/collaboration";
import type { BotTeammate } from "../src/domain/types";

function teammate(id: string, name: string, hidden = false): BotTeammate {
  return {
    id,
    name,
    title: "Specialist",
    description: "Helps",
    brief: "Help",
    pinned: false,
    hidden,
    status: "idle",
    lastInteractedAt: null,
    lastMessage: null,
    modelId: "@cf/zai-org/glm-5.3-flash",
    dailyBudgetUsd: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    connection: null
  };
}

describe("teammate mentions", () => {
  it("finds visible teammates other than the lead", () => {
    const bots = [
      teammate("lead", "Lead"),
      teammate("research", "Research"),
      teammate("old", "Old", true)
    ];
    expect(mentionedTeammates("Ask @Research and @Old", "lead", bots).map((bot) => bot.id)).toEqual(
      ["research"]
    );
  });

  it("keeps mention order, rejects partial names, and limits fan-out", () => {
    const bots = [
      teammate("lead", "Lead"),
      teammate("one", "One"),
      teammate("two", "Two"),
      teammate("three", "Three"),
      teammate("four", "Four")
    ];

    expect(
      mentionedTeammates("Ask @Four, @Two, @Three, and @One. Not @Ones.", "lead", bots).map(
        (bot) => bot.id
      )
    ).toEqual(["four", "two", "three"]);
    expect(mentionedTeammates("Ask @Ones only", "lead", bots)).toEqual([]);
  });
});
