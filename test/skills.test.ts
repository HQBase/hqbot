import { describe, expect, it } from "vitest";

import { invokedSkill, skillCommand } from "../src/domain/skills";
import type { BotSkill } from "../src/domain/types";

const skill: BotSkill = {
  id: "skill-1",
  botId: "bot-1",
  name: "Competitor brief",
  description: "Compare products",
  instructions: "Use a table",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("skills", () => {
  it("creates a stable slash command", () => {
    expect(skillCommand(" Competitor brief! ")).toBe("competitor-brief");
  });

  it("selects only a leading command", () => {
    expect(invokedSkill("/competitor-brief Acme", [skill])?.id).toBe("skill-1");
    expect(invokedSkill("Use /competitor-brief", [skill])).toBeNull();
  });
});
