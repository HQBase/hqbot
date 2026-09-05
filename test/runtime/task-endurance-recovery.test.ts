import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
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
