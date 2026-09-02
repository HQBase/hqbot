import { describe, expect, it } from "vitest";

import { skillCommand } from "../src/domain/skills";

describe("skills", () => {
  it("creates a stable slash command", () => {
    expect(skillCommand(" Competitor brief! ")).toBe("competitor-brief");
  });
});
