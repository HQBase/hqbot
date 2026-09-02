import { type ToolSet, tool } from "ai";
import { z } from "zod";

import type { TaskCoordinator } from "./task-coordinator";
import type { WorkspaceAgentRpc, WorkspaceRoutineDto } from "./types";

const recurringExample =
  '{"action":"create_recurring","name":"Monitor mail","prompt":"Check for new mail","everyMinutes":5}';
const onceExample =
  '{"action":"create_once","name":"Reminder","prompt":"Remind the owner to reply","at":"2026-09-03T14:00:00.000Z"}';
const idExample = '{"action":"pause","scheduleId":"00000000-0000-4000-8000-000000000000"}';

export const scheduleInput = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("create_once"),
      at: z.string({ error: onceExample }).trim().min(1).max(100),
      name: z.string({ error: onceExample }).trim().min(1).max(100),
      prompt: z.string({ error: onceExample }).trim().min(1).max(4_000)
    }),
    z.strictObject({
      action: z.literal("create_recurring"),
      everyMinutes: z
        .number({ error: `everyMinutes must be a JSON number. ${recurringExample}` })
        .int({ error: recurringExample })
        .min(1, { error: recurringExample })
        .max(43_200, { error: recurringExample }),
      name: z.string({ error: recurringExample }).trim().min(1).max(100),
      prompt: z.string({ error: recurringExample }).trim().min(1).max(4_000)
    }),
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({
      action: z.literal("pause"),
      scheduleId: z.string({ error: idExample }).uuid({ error: idExample })
    }),
    z.strictObject({
      action: z.literal("resume"),
      scheduleId: z.string({ error: idExample }).uuid({ error: idExample })
    }),
    z.strictObject({
      action: z.literal("delete"),
      scheduleId: z.string({ error: idExample }).uuid({ error: idExample })
    })
  ],
  `Valid examples: ${onceExample} or ${recurringExample}`
);

function recurringSchedule(routine: WorkspaceRoutineDto) {
  return {
    active: routine.active,
    everyMinutes: routine.intervalMinutes,
    id: routine.id,
    name: routine.name,
    nextRunAt: routine.nextRunAt,
    prompt: routine.prompt,
    type: "recurring" as const
  };
}

export function createScheduleTool(options: {
  botId: string;
  reconcile: () => Promise<void>;
  tasks: TaskCoordinator;
  workspaceAgent: WorkspaceAgentRpc;
}): ToolSet[string] {
  return tool({
    description:
      "Create, list, pause, resume, or delete future work. Use create_once for one future wake-up and create_recurring only when the owner explicitly asks for repeated or ongoing work.",
    inputSchema: scheduleInput,
    execute: async (input) => {
      if (input.action === "create_once") {
        const work = await options.tasks.run(() =>
          options.tasks.scheduleOnce({
            checkpoint: input.prompt,
            goal: input.name,
            wakeAt: input.at
          })
        );
        return {
          created: true,
          schedule: {
            active: true,
            id: work.taskId,
            name: input.name,
            nextRunAt: work.wakeAt,
            prompt: input.prompt,
            type: "once" as const
          }
        };
      }

      const workspace = options.workspaceAgent;
      if (input.action === "list") {
        const current = options.tasks.current();
        const once =
          current?.state === "waiting" && current.wakeAt
            ? [
                {
                  active: true,
                  id: current.taskId,
                  name: current.goal,
                  nextRunAt: current.wakeAt,
                  prompt: current.checkpoint,
                  type: "once" as const
                }
              ]
            : [];
        const recurring = (await workspace.listRoutines(options.botId)).map(recurringSchedule);
        return { schedules: [...once, ...recurring] };
      }

      if (input.action === "create_recurring") {
        const routines = await workspace.listRoutines(options.botId);
        const existing = routines.find(
          (routine) =>
            routine.name === input.name &&
            routine.prompt === input.prompt &&
            routine.intervalMinutes === input.everyMinutes
        );
        const routine = existing
          ? existing.active
            ? existing
            : await workspace.setRoutineActive(existing.id, options.botId, true)
          : await workspace.createRoutine({
              id: crypto.randomUUID(),
              botId: options.botId,
              name: input.name,
              prompt: input.prompt,
              intervalMinutes: input.everyMinutes,
              nextRunAt: new Date(Date.now() + input.everyMinutes * 60_000).toISOString()
            });
        if (!routine) throw new Error("Schedule not found");
        await options.reconcile();
        return { created: !existing, schedule: recurringSchedule(routine) };
      }

      const current = options.tasks.current();
      if (
        input.action === "delete" &&
        current?.taskId === input.scheduleId &&
        current.state === "waiting" &&
        current.wakeAt
      ) {
        await options.tasks.cancel("The one-time schedule was deleted");
        return { deleted: true, scheduleId: input.scheduleId };
      }

      if (input.action === "pause" || input.action === "resume") {
        const routine = await workspace.setRoutineActive(
          input.scheduleId,
          options.botId,
          input.action === "resume"
        );
        if (!routine) throw new Error("Recurring schedule not found");
        await options.reconcile();
        return { schedule: recurringSchedule(routine) };
      }

      const deleted = await workspace.deleteRoutine(input.scheduleId, options.botId);
      await options.reconcile();
      return { deleted, scheduleId: input.scheduleId };
    },
    toModelOutput: ({ output }) => ({ type: "text", value: JSON.stringify(output) })
  });
}
