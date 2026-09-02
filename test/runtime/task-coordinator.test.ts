import { describe, expect, it, vi } from "vitest";

import { TaskCoordinator } from "../../src/runtime/task-coordinator";
import type { ActiveWork, WorkResumePayload } from "../../src/runtime/work";

function runningWork(): ActiveWork {
  return {
    taskId: "task-1",
    goal: "Prepare a report",
    checkpoint: "The command is running",
    state: "waiting",
    generation: 1,
    wakeAt: null,
    scheduleId: "poll-1",
    submissionId: null,
    lastError: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:01:00.000Z"
  };
}

function continuationHarness(submitError?: Error) {
  let current = runningWork();
  const scheduleResume = vi.fn(async () => ({ id: "resume-1" }));
  const submitResume = submitError
    ? vi.fn(async () => {
        throw submitError;
      })
    : vi.fn(async (_work: ActiveWork, submissionId: string) => ({
        accepted: true,
        submissionId
      }));
  const store = {
    active: () => current,
    current: () => current,
    transition: (expected: ActiveWork | null, next: ActiveWork) => {
      if (current !== expected) return null;
      current = next;
      return current;
    },
    claimResume: (payload: WorkResumePayload) => {
      if (payload.taskId !== current.taskId || payload.generation !== current.generation)
        return null;
      current = {
        ...current,
        state: "running" as const,
        wakeAt: null,
        scheduleId: null,
        updatedAt: new Date().toISOString()
      };
      return current;
    },
    setSubmission: (_taskId: string, _generation: number, submissionId: string) => {
      current = { ...current, submissionId };
      return current;
    },
    put: (next: ActiveWork) => {
      current = next;
      return current;
    }
  };
  const workspaceAgent = {
    cancelTask: vi.fn(),
    completeTask: vi.fn(),
    failTask: vi.fn(),
    markInteraction: vi.fn(),
    setTaskSubmission: vi.fn(),
    startTask: vi.fn(),
    syncTaskState: vi.fn()
  };
  const tasks = new TaskCoordinator({
    botId: "bot-1",
    cancelProcess: vi.fn(),
    cancelSchedule: vi.fn(),
    cancelSubmission: vi.fn(),
    getProcess: () => null,
    getSchedule: vi.fn(),
    inspectSubmission: vi.fn(),
    latestAssistantText: () => "",
    scheduleResume,
    store,
    submitResume,
    teammateIsActive: async () => true,
    workspaceAgent
  } as never);
  return { current: () => current, scheduleResume, submitResume, tasks };
}

describe("task coordinator", () => {
  it("rejects manage_task before it enters the queue when Bash owns the task", () => {
    const tasks = new TaskCoordinator({
      getProcess: () => ({ active: true, generation: 1, hasResult: false, taskId: "task-1" })
    } as never);

    expect(() => tasks.assertManageAvailable()).toThrow(
      "Bash already manages this task and its next turn"
    );
  });

  it("submits a saved continuation immediately without a normal-path alarm", async () => {
    const runtime = continuationHarness();

    const continued = await runtime.tasks.continueFrom(runtime.current(), "The PDF is ready");

    expect(runtime.scheduleResume).not.toHaveBeenCalled();
    expect(runtime.submitResume).toHaveBeenCalledOnce();
    expect(continued).toMatchObject({
      checkpoint: "The PDF is ready",
      generation: 2,
      state: "running",
      submissionId: "task:task-1:turn:2"
    });
  });

  it("creates a recovery alarm only when immediate continuation fails", async () => {
    const runtime = continuationHarness(new Error("Think is unavailable"));

    const continued = await runtime.tasks.continueFrom(runtime.current(), "The PDF is ready");

    expect(runtime.submitResume).toHaveBeenCalledOnce();
    expect(runtime.scheduleResume).toHaveBeenCalledOnce();
    expect(continued).toMatchObject({ state: "scheduled", scheduleId: "resume-1" });
  });
});
