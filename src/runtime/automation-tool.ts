import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { type AutomationsRpc, routineSchedule } from "../domain/automations";

export function automationTools(
  workspace: AutomationsRpc,
  botId: string,
  reconcile: () => Promise<void>
): ToolSet {
  return {
    manage_automation: tool({
      description:
        "Create or edit an owner-requested routine with calendar days, local time, and IANA time zone, an interval, or an inbound-event trigger. Read the current revision before editing. Test runs use the same permissions and budget. Read history to verify the outcome. Events need separate owner setup in Automations.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({ action: z.literal("list") }),
        z.object({
          action: z.literal("save"),
          id: z.string().max(200).optional(),
          revision: z.number().int().positive().optional(),
          name: z.string().min(1).max(100),
          prompt: z.string().min(1).max(4000),
          active: z.boolean().default(true),
          schedule: routineSchedule
        }),
        z.object({ action: z.literal("test"), id: z.string().min(1).max(200) }),
        z.object({ action: z.literal("history"), id: z.string().min(1).max(200) })
      ]),
      execute: async (input, context) => {
        if (input.action === "list") return workspace.listAutomations(botId);
        if (input.action === "history") return workspace.listRoutineRuns(botId, input.id);
        if (input.action === "test")
          return workspace.queueRoutineRun(
            botId,
            input.id,
            `test:${botId}:${context.toolCallId}`,
            "manual"
          );
        const routine = await workspace.saveAutomation({ ...input, botId });
        await reconcile();
        return routine;
      }
    })
  };
}
