import { describe, expect, it } from "vitest";

import { defineBot, responseText } from "../src/domain/ai";

describe("responseText", () => {
  it("reads the current Workers AI chat completion shape", () => {
    expect(responseText({ choices: [{ message: { content: "  Ready to work.  " } }] })).toBe(
      "Ready to work."
    );
  });

  it("keeps support for legacy Workers AI text output", () => {
    expect(responseText({ response: "Legacy output" })).toBe("Legacy output");
  });

  it("reads structured text content", () => {
    expect(
      responseText({ choices: [{ message: { content: [{ type: "text", text: "Hello" }] } }] })
    ).toBe("Hello");
  });
});

describe("defineBot", () => {
  it("creates a useful teammate without an AI request", () => {
    expect(defineBot("Be my product research teammate.")).toEqual({
      name: "Research",
      title: "Be my product research teammate.",
      description: "I will help with this job: Be my product research teammate."
    });
  });
});
