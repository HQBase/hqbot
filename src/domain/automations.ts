import { z } from "zod";
import type { BotRoutine } from "./types";

export const routineSchedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), everyMinutes: z.number().int().min(1).max(43200) }),
  z.object({
    kind: z.literal("calendar"),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid time zone")
  }),
  z.object({ kind: z.literal("event") })
]);
export type RoutineSchedule = z.infer<typeof routineSchedule>;
export const automationInput = z.object({
  id: z.string().min(1).max(200).optional(),
  revision: z.number().int().positive().optional(),
  botId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1).max(4000),
  active: z.boolean().default(true),
  schedule: routineSchedule
});
export type AutomationInput = z.infer<typeof automationInput>;
export type Automation = BotRoutine & { revision: number; schedule: RoutineSchedule };
export interface RoutineRun {
  id: string;
  routineId: string;
  botId: string;
  source: "manual" | "schedule" | "event";
  state: string;
  prompt: string;
  result: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AutomationsRpc {
  listAutomations(botId?: string): Promise<Automation[]>;
  saveAutomation(input: AutomationInput): Promise<Automation>;
  queueRoutineRun(
    botId: string,
    routineId: string,
    id: string,
    source: RoutineRun["source"],
    event?: string
  ): Promise<RoutineRun>;
  routineRunForBot(id: string, botId: string): Promise<RoutineRun | null>;
  finishRoutineRun(id: string, botId: string, result: string, failed?: boolean): Promise<void>;
  listRoutineRuns(botId: string, routineId: string): Promise<RoutineRun[]>;
}
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function routineScheduleLabel(schedule: RoutineSchedule): string {
  if (schedule.kind === "event") return "When an event arrives";
  if (schedule.kind === "interval") return `Every ${schedule.everyMinutes} minutes`;
  const days = [...new Set(schedule.days)].sort();
  return `${days.length === 7 ? "Every day" : days.map((day) => weekdays[day]?.slice(0, 3)).join(", ")} at ${schedule.time} · ${schedule.timezone}`;
}
