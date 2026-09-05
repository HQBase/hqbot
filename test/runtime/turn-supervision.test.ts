import { expect, it } from "vitest";
import { checkpointStep, repeatedStepResult } from "../../src/runtime/turn-supervision";

it("allows a final reply after saving work and still forces a checkpoint near the limit", () => {
  expect(checkpointStep({ stepNumber: 38, steps: [] } as never, 40)).toMatchObject({
    activeTools: ["manage_task"]
  });
  for (const state of ["done", "scheduled", "needs_user"])
    expect(
      checkpointStep(
        {
          stepNumber: 39,
          steps: [{ toolResults: [{ toolName: "manage_task", output: { state } }] }]
        } as never,
        40
      )
    ).toMatchObject({ toolChoice: "none" });
  expect(
    checkpointStep(
      {
        stepNumber: 39,
        steps: [
          { toolResults: [{ toolName: "manage_task", output: { error: "Missing evidence" } }] }
        ]
      } as never,
      40
    )
  ).toMatchObject({ activeTools: ["manage_task"] });
});

it("stops repeated actions only when their input and result are unchanged", () => {
  const step = { toolResults: [{ toolName: "search", input: { query: "same" }, output: [] }] };
  expect(repeatedStepResult({ steps: [step, step, step] } as never)).toBe(true);
  expect(
    repeatedStepResult({
      steps: [
        step,
        step,
        { toolResults: [{ toolName: "search", input: { query: "new" }, output: [] }] }
      ]
    } as never)
  ).toBe(false);
});
