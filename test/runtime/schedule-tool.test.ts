import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";

import { createScheduleTool, scheduleInput } from "../../src/runtime/schedule-tool";
import type { TaskCoordinator } from "../../src/runtime/task-coordinator";
import type { WorkspaceAgentRpc, WorkspaceRoutineDto } from "../../src/runtime/types";

async function execute(tool: ToolSet[string], input: unknown): Promise<unknown> {
  if (!tool.execute) throw new Error("Tool is not executable");
  return tool.execute(input, {
    abortSignal: undefined,
    context: undefined,
    messages: [],
    toolCallId: "schedule-call"
  });
}

function taskStub(input: Partial<TaskCoordinator> = {}): TaskCoordinator {
  return {
    cancel: vi.fn(async () => undefined),
    current: vi.fn(() => null),
    run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    scheduleOnce: vi.fn(async ({ wakeAt }: { wakeAt: string }) => ({
      taskId: "task-1",
      wakeAt
    })),
    ...input
  } as unknown as TaskCoordinator;
}

function workspaceStub(routines: WorkspaceRoutineDto[] = []): WorkspaceAgentRpc {
  return {
    createRoutine: vi.fn(async (input) => {
      const routine = { ...input, active: true };
      routines.push(routine);
      return routine;
    }),
    deleteRoutine: vi.fn(async (id) => {
      const index = routines.findIndex((routine) => routine.id === id);
      if (index < 0) return false;
      routines.splice(index, 1);
      return true;
    }),
    listRoutines: vi.fn(async () => routines),
    setRoutineActive: vi.fn(async (id, _botId, active) => {
      const routine = routines.find((item) => item.id === id);
      if (!routine) return null;
      routine.active = active;
      return routine;
    })
  } as unknown as WorkspaceAgentRpc;
}

describe("schedule tool", () => {
  it("returns a valid example when recurring input is invalid", () => {
    const result = scheduleInput.safeParse({
      action: "create_recurring",
      everyMinutes: "5",
      name: "Inbox monitor",
      prompt: "Check for new mail"
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("The invalid schedule input was accepted");
    expect(result.error.issues[0]?.message).toContain('"everyMinutes":5');
  });

  it("rejects a standalone wait action with current schedule examples", () => {
    const result = scheduleInput.safeParse({
      action: "wait",
      wakeAt: "2026-09-03T14:00:00.000Z"
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("The removed wait action was accepted");
    expect(result.error.issues[0]?.message).toContain('"action":"create_once"');
  });

  it("creates a one-time wake-up through the task coordinator", async () => {
    const tasks = taskStub();
    const tool = createScheduleTool({
      botId: "bot-1",
      reconcile: vi.fn(),
      tasks,
      workspaceAgent: workspaceStub()
    });

    await expect(
      execute(tool, {
        action: "create_once",
        at: "2026-09-03T14:00:00.000Z",
        name: "Reminder",
        prompt: "Remind the owner"
      })
    ).resolves.toMatchObject({
      created: true,
      schedule: { id: "task-1", type: "once" }
    });
    expect(tasks.scheduleOnce).toHaveBeenCalledWith({
      checkpoint: "Remind the owner",
      goal: "Reminder",
      wakeAt: "2026-09-03T14:00:00.000Z"
    });
  });

  it("creates, reuses, pauses, lists, and deletes recurring work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
    const routines: WorkspaceRoutineDto[] = [];
    const workspace = workspaceStub(routines);
    const reconcile = vi.fn().mockResolvedValue(undefined);
    const tool = createScheduleTool({
      botId: "bot-1",
      reconcile,
      tasks: taskStub(),
      workspaceAgent: workspace
    });
    const createInput = {
      action: "create_recurring",
      everyMinutes: 5,
      name: "Inbox monitor",
      prompt: "Check for new mail"
    };

    const created = (await execute(tool, createInput)) as {
      created: boolean;
      schedule: { id: string };
    };
    expect(created).toMatchObject({ created: true, schedule: { active: true } });
    expect(workspace.createRoutine).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-1",
        intervalMinutes: 5,
        nextRunAt: "2026-09-01T12:05:00.000Z"
      })
    );

    await execute(tool, { action: "pause", scheduleId: created.schedule.id });
    const reused = await execute(tool, createInput);
    expect(reused).toMatchObject({ created: false, schedule: { active: true } });
    expect(workspace.createRoutine).toHaveBeenCalledOnce();
    expect(await execute(tool, { action: "list" })).toMatchObject({
      schedules: [{ id: created.schedule.id, type: "recurring" }]
    });

    expect(await execute(tool, { action: "delete", scheduleId: created.schedule.id })).toEqual({
      deleted: true,
      scheduleId: created.schedule.id
    });
    expect(routines).toEqual([]);
    expect(reconcile).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
