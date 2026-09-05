import type { PrepareStepContext, StepConfig } from "@cloudflare/think";
import { canonicalizeJson } from "./external-effects";

export const DEFAULT_TURN_STEPS = 40;

export function repeatedStepResult(ctx: PrepareStepContext): boolean {
  if (ctx.steps.length < 3) return false;
  const last = ctx.steps.slice(-3);
  const signatures = last.map((step) => {
    if (!step.toolResults.length) return null;
    try {
      return canonicalizeJson(
        step.toolResults.map((result) => ({
          name: result.toolName,
          input: result.input ?? null,
          output: result.output ?? null
        }))
      );
    } catch {
      return null;
    }
  });
  return signatures[0] !== null && signatures.every((value) => value === signatures[0]);
}

export function checkpointStep(ctx: PrepareStepContext, maxSteps: number): StepConfig | undefined {
  if (
    ctx.steps.at(-1)?.toolResults.some((result) => {
      if (result.toolName !== "manage_task" || !result.output || typeof result.output !== "object")
        return false;
      return ["scheduled", "needs_user", "done"].includes(
        String(Reflect.get(result.output, "state"))
      );
    })
  )
    return { toolChoice: "none" } as unknown as StepConfig;
  if (ctx.stepNumber >= Math.max(0, maxSteps - 3))
    return {
      activeTools: ["manage_task"],
      toolChoice: { type: "tool", toolName: "manage_task" }
    } as unknown as StepConfig;
}
