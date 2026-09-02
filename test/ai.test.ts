import { describe, expect, it } from "vitest";

import { defineBot, defineConversationBot, generatedTeammateName } from "../src/domain/ai";

describe("defineBot", () => {
  it("creates a useful teammate without an AI request", () => {
    expect(defineBot("Be my product research teammate.")).toEqual({
      name: "Research",
      title: "Be my product research teammate.",
      description: "I will help with this job: Be my product research teammate."
    });
  });

  it("builds a conversation profile from its ID, not the first prompt", () => {
    const profile = defineConversationBot("bot-1");
    expect(profile).toEqual({
      name: generatedTeammateName("bot-1"),
      title: generatedTeammateName("bot-1"),
      description: "A helpful teammate for everyday questions and tasks.",
      brief: "Answer the owner directly. Follow the instructions in the conversation."
    });
    expect(JSON.stringify(profile)).not.toContain("Research my inbox");
  });

  it("generates stable friendly names without an AI request", () => {
    expect(generatedTeammateName("bot-1")).toBe(generatedTeammateName("bot-1"));
    expect(generatedTeammateName("bot-1")).toMatch(/^[A-Z][a-z]+$/u);
  });
});
