import { describe, expect, it } from "vitest"

import { responseText } from "../src/domain/ai"

describe("responseText", () => {
  it("reads the current Workers AI chat completion shape", () => {
    expect(responseText({ choices: [{ message: { content: "  Ready to work.  " } }] })).toBe(
      "Ready to work.",
    )
  })

  it("keeps support for legacy Workers AI text output", () => {
    expect(responseText({ response: "Legacy output" })).toBe("Legacy output")
  })

  it("reads structured text content", () => {
    expect(
      responseText({ choices: [{ message: { content: [{ type: "text", text: "Hello" }] } }] }),
    ).toBe("Hello")
  })
})
