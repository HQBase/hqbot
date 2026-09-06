import { describe, expect, it, vi } from "vitest";
import {
  checkTaskWatchdog,
  TASK_STALL_MS,
  type TaskWatchdogHost
} from "../../src/runtime/task-watchdog";
import type { ActiveWork } from "../../src/runtime/work";

function fixture() {
  const now = Date.now();
  let work: ActiveWork = {
    taskId: "task",
    generation: 2,
    state: "running",
    goal: "Report",
    checkpoint: "Next step",
    createdAt: new Date(now - 600_000).toISOString(),
    updatedAt: new Date(now - 600_000).toISOString(),
    lastError: null,
    wakeAt: null,
    scheduleId: null,
    submissionId: null
  };
  const host = {
    tasks: {
      current: () => work,
      run: async (fn: () => Promise<void>) => fn(),
      reconcile: vi.fn(async () => undefined),
      transition: (previous: ActiveWork, next: ActiveWork) => {
        if (previous !== work) return null;
        work = next;
        return work;
      },
      syncProjection: vi.fn(async () => undefined),
      markExternalEffectUncertain: vi.fn(async () => {
        work = { ...work, state: "uncertain" };
      }),
      markRecoveryFailure: vi.fn(async () => {
        work = { ...work, state: "uncertain" };
      })
    },
    blocked: vi.fn(async () => false),
    stable: vi.fn(async () => true),
    heartbeat: vi.fn(
      async () => undefined as { taskId: string; generation: number; at: number } | undefined
    ),
    submissionPending: vi.fn(async () => false),
    unresolvedEffect: vi.fn(() => false),
    retry: vi.fn(() => true),
    abort: vi.fn(),
    now: () => now
  };
  return {
    host,
    read: () => work,
    set: (patch: Partial<ActiveWork>) => {
      work = { ...work, ...patch };
    },
    check: () => checkTaskWatchdog(host as unknown as TaskWatchdogHost),
    now
  };
}
describe("durable task watchdog", () => {
  it("reconciles an idle running task even when no normal response callback arrived", async () => {
    const f = fixture();
    await f.check();
    expect(f.host.tasks.reconcile).toHaveBeenCalledOnce();
    expect(f.host.abort).not.toHaveBeenCalled();
  });
  it("keeps a streaming or recently started turn alive", async () => {
    const f = fixture();
    f.host.stable.mockResolvedValue(false);
    f.host.heartbeat.mockResolvedValue({ taskId: "task", generation: 2, at: f.now - 30_000 });
    await f.check();
    expect(f.host.abort).not.toHaveBeenCalled();
    expect(f.host.tasks.reconcile).not.toHaveBeenCalled();
  });
  it("fences a stale turn before abort and recovers only after it stops", async () => {
    const f = fixture();
    f.host.stable.mockResolvedValueOnce(false).mockResolvedValue(true);
    f.host.abort.mockImplementation(() => {
      expect(f.read()).toMatchObject({ state: "scheduled", generation: 3 });
    });
    await f.check();
    expect(f.host.abort).toHaveBeenCalledOnce();
    expect(f.host.tasks.reconcile).toHaveBeenCalledOnce();
  });
  it("cannot treat a heartbeat from another task or generation as progress", async () => {
    const f = fixture();
    f.host.stable.mockResolvedValueOnce(false).mockResolvedValue(true);
    f.host.heartbeat.mockResolvedValue({ taskId: "old", generation: 2, at: f.now });
    await f.check();
    expect(f.host.abort).toHaveBeenCalledOnce();
  });
  it.each([
    "needs_user",
    "uncertain",
    "cancelled",
    "failed",
    "done",
    "waiting"
  ] as const)("does not revive %s work", async (state) => {
    const f = fixture();
    f.set({ state });
    await f.check();
    expect(f.host.tasks.reconcile).not.toHaveBeenCalled();
    expect(f.host.abort).not.toHaveBeenCalled();
  });
  it("does not interrupt pending approvals, handoffs or managed processes", async () => {
    const f = fixture();
    f.host.blocked.mockResolvedValue(true);
    await f.check();
    expect(f.host.stable).not.toHaveBeenCalled();
  });
  it("never repeats an external effect with an unknown outcome", async () => {
    const f = fixture();
    f.host.unresolvedEffect.mockReturnValue(true);
    await f.check();
    expect(f.read().state).toBe("uncertain");
    expect(f.host.tasks.reconcile).not.toHaveBeenCalled();
  });
  it("fails after the bounded recovery allowance is exhausted", async () => {
    const f = fixture();
    f.host.stable.mockResolvedValueOnce(false).mockResolvedValue(true);
    f.host.retry.mockReturnValue(false);
    await f.check();
    expect(f.read().state).toBe("failed");
    expect(f.host.tasks.reconcile).not.toHaveBeenCalled();
  });
  it("requires attention when a stalled turn cannot be stopped", async () => {
    const f = fixture();
    f.host.stable.mockResolvedValue(false);
    await f.check();
    expect(f.read().state).toBe("uncertain");
    expect(f.host.tasks.reconcile).not.toHaveBeenCalled();
  });
  it("does not race an owner stop during the engine check", async () => {
    const f = fixture();
    f.host.stable.mockImplementation(async () => {
      f.set({ state: "cancelled", generation: 3, updatedAt: new Date(f.now).toISOString() });
      return true;
    });
    await f.check();
    expect(f.host.tasks.reconcile).not.toHaveBeenCalled();
  });
  it("uses the five minute threshold when no heartbeat was saved by an older version", async () => {
    const f = fixture();
    f.host.stable.mockResolvedValue(false);
    f.set({ updatedAt: new Date(f.now - TASK_STALL_MS + 1).toISOString() });
    await f.check();
    expect(f.host.abort).not.toHaveBeenCalled();
  });
});

it("recovers a stale saved running submission even when the turn engine is idle", async () => {
  const f = fixture();
  f.set({ submissionId: "old-turn" });
  f.host.submissionPending.mockResolvedValue(true);
  await f.check();
  expect(f.host.abort).toHaveBeenCalledOnce();
  expect(f.host.tasks.reconcile).toHaveBeenCalledOnce();
  expect(f.read()).toMatchObject({ generation: 3, state: "scheduled", submissionId: null });
});
it("does not replace a newly queued submission", async () => {
  const f = fixture();
  f.set({ submissionId: "queued", updatedAt: new Date(f.now).toISOString() });
  f.host.submissionPending.mockResolvedValue(true);
  await f.check();
  expect(f.host.abort).not.toHaveBeenCalled();
  expect(f.host.tasks.reconcile).not.toHaveBeenCalled();
});
