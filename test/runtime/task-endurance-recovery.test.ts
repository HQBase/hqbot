import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeOwnerTask } from "../../src/runtime/owner-task-resume";
import { TaskCoordinator, type TaskCoordinatorOptions } from "../../src/runtime/task-coordinator";
import { TaskSupervision } from "../../src/runtime/task-supervision";
import {
  type ActiveWork,
  migrateTeammateWork,
  TeammateWorkStore,
  type WorkResumePayload
} from "../../src/runtime/work";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";
import { projectTask } from "../../src/workspace/task-projection";

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
});

function harness() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateWorkspace(sql);
  migrateTeammateWork(sql);
  new WorkspaceCatalog(sql).createBot(
    "orion",
    { name: "Orion", title: "Test", description: "Test" },
    "Test",
    "@cf/zai-org/glm-5.3-flash",
    2
  );
  const store = new TeammateWorkStore(sql);
  const supervisor = new TaskSupervision(
    sql,
    async () => null,
    () => []
  );
  const schedules = new Map<string, { at: Date; payload: WorkResumePayload }>();
  const submitResume = vi.fn(async (_work: ActiveWork, submissionId: string) => ({
    accepted: true,
    submissionId
  }));
  const cancelSubmission = vi.fn(async () => undefined);
  const options = {
    botId: "orion",
    store,
    supervisor,
    cancelProcess: async (current: ActiveWork | null, next: ActiveWork | null) =>
      next ? store.transition(current, next) : null,
    cancelSchedule: async (id: string) => schedules.delete(id),
    cancelSubmission,
    getProcess: () => null,
    getSchedule: async (id: string) => schedules.get(id),
    inspectSubmission: async () => null,
    latestAssistantText: () => "",
    scheduleResume: async (at: Date, payload: WorkResumePayload) => {
      const id = crypto.randomUUID();
      schedules.set(id, { at, payload });
      return { id };
    },
    submitResume,
    teammateIsActive: async () => true,
    workspaceAgent: {
      projectTask: async (input: Parameters<typeof projectTask>[1]) => {
        projectTask(sql, input);
      },
      setTaskSubmission: async () => undefined,
      markInteraction: async () => undefined
    }
  } as unknown as TaskCoordinatorOptions;
  return {
    db,
    store,
    supervisor,
    schedules,
    submitResume,
    cancelSubmission,
    restart: () => new TaskCoordinator(options)
  };
}

describe("endurance recovery", () => {
  it("preserves hourly wake-ups through 24 simulated restarts and submits each wake once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T02:17:00Z"));
    const h = harness();
    let tasks = h.restart();
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(Date.now() + 3_600_000);
      await tasks.scheduleOnce({
        goal: "Endurance test",
        checkpoint: `Milestone ${hour + 1}`,
        wakeAt: at.toISOString()
      });
      expect(h.schedules.size).toBe(1);
      const entry = [...h.schedules.entries()][0];
      if (!entry) throw new Error("Missing wake-up");
      const [id, schedule] = entry;
      tasks = h.restart();
      const before = h.db.prepare("SELECT status,last_interacted_at FROM bots").get();
      await tasks.reconcile();
      await tasks.reconcile();
      expect(h.db.prepare("SELECT status,last_interacted_at FROM bots").get()).toEqual(before);
      expect(h.schedules.size).toBe(1);
      vi.setSystemTime(at);
      await tasks.resume(schedule.payload);
      h.schedules.delete(id);
      expect(h.store.current()?.state).toBe("running");
    }
    expect(h.submitResume).toHaveBeenCalledTimes(24);
    expect(new Set(h.submitResume.mock.calls.map((call) => call[1])).size).toBe(24);
  });

  it("saves a cancellation reason and rejects the late scheduled callback after restart", async () => {
    const h = harness();
    let tasks = h.restart();
    await tasks.scheduleOnce({
      goal: "Endurance test",
      checkpoint: "Milestone 6",
      wakeAt: new Date(Date.now() + 3_600_000).toISOString()
    });
    const schedule = [...h.schedules.values()][0];
    if (!schedule) throw new Error("Missing wake-up");
    await tasks.cancel("The owner stopped this teammate");
    expect(h.schedules.size).toBe(0);
    expect(h.store.current()).toMatchObject({
      state: "cancelled",
      lastError: "The owner stopped this teammate",
      wakeAt: null
    });
    const snapshot = h.db.prepare("SELECT * FROM bots").all();
    tasks = h.restart();
    await tasks.reconcile();
    await tasks.resume(schedule.payload);
    expect(h.submitResume).not.toHaveBeenCalled();
    expect(h.db.prepare("SELECT * FROM bots").all()).toEqual(snapshot);
    const saved = h.store.current();
    expect(
      h.supervisor
        .milestones(saved?.taskId ?? "")
        .some((row) => String(row.evidence).includes("The owner stopped"))
    ).toBe(true);
  });

  it("records an aborted runtime turn separately from an owner stop", async () => {
    const h = harness();
    const tasks = h.restart();
    await tasks.scheduleOnce({
      goal: "Test",
      checkpoint: "Start",
      wakeAt: new Date(Date.now() + 60_000).toISOString()
    });
    const schedule = [...h.schedules.values()][0];
    if (!schedule) throw new Error("Missing wake-up");
    await tasks.resume(schedule.payload);
    const current = h.store.current();
    await tasks.settleTurn(
      current?.taskId,
      current?.generation,
      "aborted",
      "",
      "Runtime submission aborted"
    );
    expect(h.store.current()).toMatchObject({
      state: "cancelled",
      lastError: "Runtime submission aborted"
    });
  });
});

describe("owner task resume", () => {
  async function waiting() {
    const h = harness();
    const tasks = h.restart();
    await tasks.manage({
      action: "needs_user",
      goal: "Prepare a report",
      checkpoint: "Finish after sign-in"
    });
    const work = h.store.current();
    if (!work) throw new Error("Missing saved task");
    return {
      ...h,
      tasks,
      work,
      metadata: { source: "computer-decision", taskId: work.taskId, generation: work.generation }
    };
  }

  it.each([
    "computer-decision",
    "integration-result"
  ])("continues beyond the resumed %s turn without another owner message", async (source) => {
    const h = await waiting();
    const metadata = { ...h.metadata, source, integrationResultId: "handoff:login" };
    await resumeOwnerTask(h.tasks, metadata, async () => false);
    expect(h.store.current()).toMatchObject({
      state: "running",
      generation: h.work.generation,
      checkpoint: h.work.checkpoint,
      submissionId: source === "integration-result" ? "handoff:login" : null
    });
    await h.tasks.settleTurn(h.work.taskId, h.work.generation, "completed", "Still working");
    expect(h.submitResume).toHaveBeenCalledOnce();
    expect(h.store.current()).toMatchObject({
      state: "running",
      generation: h.work.generation + 1
    });
    await resumeOwnerTask(h.tasks, metadata, async () => false);
    expect(h.submitResume).toHaveBeenCalledOnce();
  });

  it("repairs the saved legacy wait after restart and schedules only one wake", async () => {
    const h = await waiting();
    const restarted = h.restart();
    await resumeOwnerTask(restarted, h.metadata, async () => false);
    await restarted.reconcile();
    await resumeOwnerTask(h.restart(), h.metadata, async () => false);
    await h.restart().reconcile();
    expect(h.schedules.size).toBe(1);
    const wake = [...h.schedules.values()][0];
    if (!wake) throw new Error("Missing recovery wake");
    await h.restart().resume(wake.payload);
    expect(h.submitResume).toHaveBeenCalledOnce();
    expect(h.store.current()?.state).toBe("running");
  });

  it("keeps open approvals and sign-in handoffs waiting", async () => {
    const h = await waiting();
    await resumeOwnerTask(h.tasks, h.metadata, async () => true);
    await h.tasks.reconcile();
    expect(h.store.current()?.state).toBe("needs_user");
    expect(h.schedules.size).toBe(0);
  });

  it("ignores stale, unrelated, and untrusted metadata", async () => {
    const h = await waiting();
    for (const metadata of [
      undefined,
      { ...h.metadata, taskId: "other" },
      { ...h.metadata, generation: 0 },
      { ...h.metadata, source: "active-task" }
    ])
      await resumeOwnerTask(h.tasks, metadata, async () => false);
    expect(h.store.current()?.state).toBe("needs_user");
    await h.tasks.manage({ action: "needs_user", checkpoint: "A new question needs an answer" });
    await resumeOwnerTask(h.tasks, h.metadata, async () => false);
    expect(h.store.current()?.state).toBe("needs_user");
  });

  it.each([
    "cancelled",
    "done",
    "failed",
    "uncertain"
  ] as const)("never revives %s work", async (state) => {
    const h = await waiting();
    h.store.put({ ...h.work, state });
    await resumeOwnerTask(h.tasks, h.metadata, async () => false);
    expect(h.store.current()?.state).toBe(state);
    expect(h.schedules.size).toBe(0);
  });

  it("does not override a supervisor pause or an intervening stop", async () => {
    const h = await waiting();
    h.store.put({ ...h.work, lastError: "Progress needs review" });
    await resumeOwnerTask(h.tasks, h.metadata, async () => false);
    expect(h.store.current()?.state).toBe("needs_user");
    h.store.put(h.work);
    await resumeOwnerTask(h.tasks, h.metadata, async () => {
      await h.tasks.cancel();
      return false;
    });
    expect(h.store.current()?.state).toBe("cancelled");
  });
});
