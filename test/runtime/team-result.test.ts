import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import { savedTeamResult } from "../../src/runtime/team-result";

const message = (id: string, role: "user" | "assistant", text: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text }]
});
it("recovers only the final answer for the exact submission", () => {
  const messages = [
    message("earlier", "assistant", "An unrelated answer"),
    message("team-work:one", "user", "Assignment"),
    message("first", "assistant", "Working"),
    message("final", "assistant", "Checked evidence")
  ];
  expect(savedTeamResult(messages, "team-work:one")).toBe("Checked evidence");
  expect(savedTeamResult(messages, "missing")).toBeNull();
  expect(
    savedTeamResult(
      [
        ...messages,
        message("new", "user", "Unrelated request"),
        message("other", "assistant", "Other answer")
      ],
      "team-work:one"
    )
  ).toBeNull();
  expect(
    savedTeamResult([message("team-work:one", "user", "Assignment")], "team-work:one")
  ).toBeNull();
});
