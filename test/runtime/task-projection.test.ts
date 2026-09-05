import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActiveWork } from "../../src/runtime/work";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";
import { projectTask } from "../../src/workspace/task-projection";

describe("durable task projection", () => {
  let db: DatabaseSync;
  let sql: Sql;
  const stamp = "2026-09-05T07:17:00.000Z";
  const work = (overrides: Partial<ActiveWork> = {}): ActiveWork => ({
    taskId: "soak",
    goal: "Hourly endurance test",
    checkpoint: "Milestones 1 through 6",
    state: "waiting",
    generation: 12,
    wakeAt: "2026-09-05T08:17:00.000Z",
    scheduleId: "alarm",
    submissionId: null,
    lastError: null,
    createdAt: "2026-09-05T02:16:17.000Z",
    updatedAt: stamp,
    ...overrides
  });
  const project = (value: ActiveWork) => projectTask(sql, { botId: "orion", work: value });
  const bot = () =>
    db.prepare("SELECT status, last_message, last_interacted_at FROM bots WHERE id='orion'").get();

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
      db
        .prepare(parts.join("?"))
        .all(
          ...values.map((value) => (typeof value === "boolean" ? Number(value) : value))
        )) as Sql;
    migrateWorkspace(sql);
    new WorkspaceCatalog(sql).createBot(
      "orion",
      { name: "Orion", title: "Test", description: "Test" },
      "Test",
      "@cf/zai-org/glm-5.3-flash",
      2
    );
  });
  afterEach(() => db.close());

  it("replays cancelled work without marking it working or changing activity time", () => {
    project(work());
    const cancelled = work({
      state: "cancelled",
      generation: 13,
      wakeAt: null,
      lastError: "The owner stopped this teammate",
      updatedAt: "2026-09-05T08:14:15.000Z"
    });
    expect(project(cancelled)).toBe(true);
    const before = bot();
    const history = db.prepare("SELECT * FROM activity").all();
    expect(project(cancelled)).toBe(false);
    expect(project(cancelled)).toBe(false);
    expect(bot()).toEqual(before);
    expect(bot()).toMatchObject({ status: "idle", last_interacted_at: cancelled.updatedAt });
    expect(db.prepare("SELECT * FROM activity").all()).toEqual(history);
    expect(db.prepare("SELECT status, error FROM tasks").get()).toEqual({
      status: "cancelled",
      error: cancelled.lastError
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='cancelled'").get()
    ).toEqual({ n: 1 });
  });

  it("rejects an old wake projection after cancellation", () => {
    const pending = work();
    project(pending);
    project(work({ generation: 13, state: "cancelled", wakeAt: null }));
    expect(project({ ...pending, state: "running", updatedAt: "2026-09-05T09:00:00.000Z" })).toBe(
      false
    );
    expect(db.prepare("SELECT status, work_state, wake_at FROM tasks").get()).toEqual({
      status: "cancelled",
      work_state: "cancelled",
      wake_at: null
    });
  });

  it("does not overwrite newer chat activity when an old final task is recovered", () => {
    const later = "2026-09-05T12:00:00.000Z";
    sql`UPDATE bots SET status='working', last_message='New request', last_interacted_at=${later} WHERE id='orion'`;
    project(work({ state: "done", generation: 13, wakeAt: null, checkpoint: "Old report ready" }));
    expect(bot()).toEqual({
      status: "working",
      last_message: "New request",
      last_interacted_at: later
    });
  });

  it("shows future wake-ups as idle and running turns as working", () => {
    project(work());
    expect(bot()).toMatchObject({ status: "idle" });
    project(work({ state: "running", wakeAt: null, updatedAt: "2026-09-05T08:17:00.000Z" }));
    expect(bot()).toMatchObject({ status: "working" });
    expect(project(work())).toBe(false);
  });

  it("keeps legacy cancellations stopped and reports a missing reason honestly", () => {
    sql`INSERT INTO tasks (id, bot_id, source, status, prompt, created_at, updated_at)
      VALUES ('soak','orion','chat','cancelled','Hourly endurance test',${stamp},${stamp})`;
    expect(project(work())).toBe(false);
    project(work({ state: "cancelled", generation: 13, wakeAt: null }));
    expect(db.prepare("SELECT status, error FROM tasks").get()).toEqual({
      status: "cancelled",
      error: "Cancellation reason was not recorded."
    });
  });

  it("does not cross teammate ownership", () => {
    project(work());
    expect(() => projectTask(sql, { botId: "another", work: work() })).toThrow("another teammate");
  });
});
