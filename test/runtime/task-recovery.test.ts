import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { TaskCoordinatorOptions } from "../../src/runtime/task-coordinator";
import { TaskRecovery } from "../../src/runtime/task-recovery";
import type { ActiveWork, WorkResumePayload } from "../../src/runtime/work";

const payload: WorkResumePayload = {
  taskId: "task-1",
  generation: 1,
  goal: "Prepare a report",
  checkpoint: "Start the report",
  createdAt: "2026-09-01T12:00:00.000Z",
  predecessorGeneration: null,
  predecessorTaskId: null,
  transitionAt: "2026-09-01T12:00:00.000Z"
};

function runningWork(): ActiveWork {
  return {
    taskId: payload.taskId,
    goal: payload.goal,
    checkpoint: payload.checkpoint,
    state: "running",
    generation: payload.generation,
    wakeAt: null,
    scheduleId: null,
    submissionId: null,
    lastError: null,
    createdAt: payload.createdAt,
    updatedAt: payload.transitionAt
  };
}

describe("task recovery", () => {
  it("does not deduplicate one-shot resume retries", async () => {
    const source = await readFile(
      new URL("../../src/teammate-runtime.ts", import.meta.url),
      "utf8"
    );

    expect(source).toMatch(
      /this\.schedule\(when, "resumeTask", payload, \{ idempotent: false, retry: scheduleRetry \}\)/u
    );
  });

  it("submits resumed Think turns outside the task queue", async () => {
    const source = await readFile(new URL("../../src/teammate.ts", import.meta.url), "utf8");

    expect(source).toMatch(
      /resumeTask\(payload: WorkResumePayload\): Promise<void> \{\s+return this\.tasks\.resume\(payload\);/u
    );
  });

  it("marks a claimed turn uncertain when submit and rearm both fail", async () => {
    let current = runningWork();
    const markInteraction = vi.fn(async () => undefined);
    const host = {
      cancel: vi.fn(),
      current: () => current,
      settleSubmission: vi.fn(),
      syncProjection: vi.fn(async () => undefined),
      transition: (_previous: ActiveWork | null, next: ActiveWork) => {
        current = next;
        return next;
      }
    };
    const options = {
      botId: "bot-1",
      cancelProcess: vi.fn(),
      cancelSchedule: vi.fn(),
      cancelSubmission: vi.fn(),
      getProcess: () => null,
      getSchedule: vi.fn(),
      inspectSubmission: vi.fn(),
      latestAssistantText: () => "",
      scheduleResume: vi.fn(async () => {
        throw new Error("schedule unavailable");
      }),
      store: {
        claimResume: () => current,
        setSubmission: vi.fn()
      },
      submitResume: vi.fn(async () => {
        throw new Error("submit unavailable");
      }),
      teammateIsActive: async () => true,
      workspaceAgent: { markInteraction }
    } as unknown as TaskCoordinatorOptions;

    await new TaskRecovery(options, host).resume(payload);

    expect(current).toMatchObject({
      state: "uncertain",
      lastError: "The task turn could not be submitted or scheduled"
    });
    expect(markInteraction).toHaveBeenCalledWith(
      "bot-1",
      "Task continuation needs attention",
      "idle"
    );
  });
});
