import type {
  ThinkIntervalSchedule,
  ThinkScheduledTaskContext,
  ThinkScheduledTasks,
  ThinkWallClockSchedule
} from "@cloudflare/think";

import type { WorkspaceRoutineDto } from "./types";

export function intervalSchedule(value: number): ThinkIntervalSchedule {
  const minutes = Math.max(1, Math.round(value));
  return `every ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function teammateScheduledTasks(
  routines: WorkspaceRoutineDto[],
  checkpointComputer: () => Promise<void>,
  dispatch?: (routine: WorkspaceRoutineDto, context: ThinkScheduledTaskContext) => Promise<void>
): ThinkScheduledTasks {
  const tasks: ThinkScheduledTasks = {
    system_computer_checkpoint: {
      schedule: "every 1 hour",
      handler: checkpointComputer
    }
  };
  for (const routine of routines) {
    if (!routine.active || routine.schedule?.kind === "event") continue;
    const action = dispatch
      ? { handler: (context: ThinkScheduledTaskContext) => dispatch(routine, context) }
      : { prompt: `[hqbot:routine]\n${routine.name}\n\n${routine.prompt}` };
    const metadata = { routineId: routine.id, source: "routine" };
    if (routine.schedule?.kind === "calendar") {
      const weekdays = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday"
      ];
      const schedule = `every week on ${[...new Set(routine.schedule.days)]
        .sort()
        .map((day) => weekdays[day])
        .join(",")} at ${routine.schedule.time}` as ThinkWallClockSchedule;
      tasks[`routine_${routine.id}`] = {
        ...action,
        metadata,
        schedule,
        timezone: routine.schedule.timezone
      };
    } else
      tasks[`routine_${routine.id}`] = {
        ...action,
        metadata,
        schedule: intervalSchedule(routine.schedule?.everyMinutes ?? routine.intervalMinutes)
      };
  }
  return tasks;
}
