import type { PrepareStepContext } from "@cloudflare/think";
import { expect, it, vi } from "vitest";
import { prepareTeamStep } from "../../src/runtime/team-step";

it("ends a coordination handoff without reading more guidance or scheduling a poll", async () => {
  const workspace = { teamBriefing: vi.fn() };
  for (const output of [{ waiting: true }, { state: "completed" }]) {
    const ctx = {
      steps: [{ toolResults: [{ toolName: "coordinate", output }] }],
      messages: []
    } as unknown as PrepareStepContext;
    expect(await prepareTeamStep(ctx, "work", "bot", workspace)).toEqual({ toolChoice: "none" });
  }
  expect(workspace.teamBriefing).not.toHaveBeenCalled();
});
it("adds saved guidance at the next model step while preserving the current messages", async () => {
  const messages = [{ role: "user", content: "Original task" }];
  const workspace = {
    teamBriefing: vi.fn(async () => ({
      modelId: null,
      assignmentId: "assignment",
      instructions: "Check a public source"
    }))
  };
  const ctx = { steps: [], messages } as unknown as PrepareStepContext;
  expect(await prepareTeamStep(ctx, "work", "bot", workspace)).toEqual({
    messages: [...messages, { role: "user", content: "Check a public source" }]
  });
  expect(messages).toHaveLength(1);
  expect(await prepareTeamStep(ctx, undefined, "bot", workspace)).toBeUndefined();
});
