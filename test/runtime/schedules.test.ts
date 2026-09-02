import { describe, expect, it, vi } from "vitest";

import { teammateScheduledTasks } from "../../src/runtime/schedules";

describe("teammate schedules", () => {
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
