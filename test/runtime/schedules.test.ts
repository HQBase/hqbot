import { describe, expect, it, vi } from "vitest";

import { teammateScheduledTasks } from "../../src/runtime/schedules";

describe("teammate schedules", () => {
  it("dispatches calendar occurrences with their time zone and durable occurrence ID", async () => {
    const dispatch = vi.fn(async () => undefined);
    const tasks = teammateScheduledTasks(
      [
        {
          id: "calendar",
          name: "Morning brief",
          prompt: "Check updates",
          active: true,
          intervalMinutes: 1440,
          nextRunAt: "",
          schedule: {
            kind: "calendar",
            days: [5, 1, 1],
            time: "09:30",
            timezone: "America/Toronto"
          }
        },
        {
          id: "event",
          name: "Issue opened",
          prompt: "Review",
          active: true,
          intervalMinutes: 1440,
          nextRunAt: "",
          schedule: { kind: "event" }
        }
      ],
      vi.fn(async () => undefined),
      dispatch
    );
    expect(tasks.routine_calendar).toMatchObject({
      schedule: "every week on monday,friday at 09:30",
      timezone: "America/Toronto"
    });
    expect(tasks.routine_event).toBeUndefined();
    const context = { idempotencyKey: "occurrence-1", scheduledFor: 123 } as never;
    await tasks.routine_calendar?.handler?.(context);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: "calendar" }), context);
  });
  it("uses one hourly computer recovery checkpoint and keeps active routines", async () => {
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    const tasks = teammateScheduledTasks(
      [
        {
          active: true,
          id: "daily",
          intervalMinutes: 1_440,
          name: "Daily review",
          nextRunAt: "2026-09-03T12:00:00.000Z",
          prompt: "Review the inbox"
        },
        {
          active: false,
          id: "paused",
          intervalMinutes: 10,
          name: "Paused",
          nextRunAt: "2026-09-02T12:10:00.000Z",
          prompt: "Do not run"
        }
      ],
      checkpoint
    );

    expect(Object.keys(tasks).sort()).toEqual(["routine_daily", "system_computer_checkpoint"]);
    expect(tasks.system_computer_checkpoint).toMatchObject({ schedule: "every 1 hour" });
    await tasks.system_computer_checkpoint?.handler?.({} as never);
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(tasks.routine_daily).toMatchObject({
      metadata: { routineId: "daily", source: "routine" },
      prompt: "[hqbot:routine]\nDaily review\n\nReview the inbox",
      schedule: "every 1440 minutes"
    });
  });
});
