import type { PrepareStepContext, StepConfig } from "@cloudflare/think";
import type { TeamWorkRpc } from "../domain/team-work";

export async function prepareTeamStep(
  ctx: PrepareStepContext,
  workId: string | undefined,
  botId: string,
  workspace: Pick<TeamWorkRpc, "teamBriefing">
): Promise<StepConfig | undefined> {
  const changed = ctx.steps
    .at(-1)
    ?.toolResults.some(
      (result) =>
        result.toolName === "coordinate" &&
        typeof result.output === "object" &&
        result.output !== null &&
        (("waiting" in result.output && result.output.waiting) ||
          ("state" in result.output && result.output.state === "completed"))
    );
  // Think forwards AI SDK step overrides. Its Omit type loses keys from the optional result union.
  if (changed) return { toolChoice: "none" } as unknown as StepConfig;
  if (!workId) return;
  const briefing = await workspace.teamBriefing(botId, workId);
  if (briefing?.instructions)
    return {
      messages: [...ctx.messages, { role: "user", content: briefing.instructions }]
    } as unknown as StepConfig;
}
