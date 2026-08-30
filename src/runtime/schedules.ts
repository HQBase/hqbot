import type { ThinkIntervalSchedule, ThinkScheduledTasks } from "@cloudflare/think";

import type { WorkspaceRoutineDto } from "./types";

export function intervalSchedule(value: number): ThinkIntervalSchedule {
  const minutes = Math.max(1, Math.round(value));
  return `every ${minutes} minutes`;
}

export function teammateScheduledTasks(
  routines: WorkspaceRoutineDto[],
  sweepBrowser: () => Promise<void>
): ThinkScheduledTasks {
  const tasks: ThinkScheduledTasks = {
    system_browser_sweep: {
      schedule: "every 1 hour",
      handler: sweepBrowser
    }
  };
  for (const routine of routines) {
    if (!routine.active) continue;
    tasks[`routine_${routine.id}`] = {
      schedule: intervalSchedule(routine.intervalMinutes),
      prompt: `[hqbot:routine]\n${routine.name}\n\n${routine.prompt}`,
      metadata: { routineId: routine.id, source: "routine" }
    };
  }
  return tasks;
}
