import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  type ActiveWork,
  type ManagedLinuxProcess,
  migrateTeammateWork,
  TeammateLinuxProcessStore,
  TeammateWorkStore
} from "../../src/runtime/work";
import type { Sql, SqlValue } from "../../src/workspace/sql";

function bind(value: SqlValue): SQLInputValue {
  return typeof value === "boolean" ? Number(value) : value;
}

function sqlFor(database: DatabaseSync): Sql {
  return ((strings: TemplateStringsArray, ...values: SqlValue[]) => {
    let statement = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) {
      statement += `?${strings[index + 1] ?? ""}`;
    }
    return database.prepare(statement).all(...values.map(bind));
  }) as Sql;
}

function work(overrides: Partial<ActiveWork> = {}): ActiveWork {
  return {
    taskId: "task-1",
    goal: "Research the request",
    checkpoint: "Found the primary source",
    state: "scheduled",
    generation: 1,
    wakeAt: "2026-09-01T12:00:01.000Z",
    scheduleId: "schedule-1",
    submissionId: null,
    lastError: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides
  };
}

function process(overrides: Partial<ManagedLinuxProcess> = {}): ManagedLinuxProcess {
  return {
    processId: "process-1",
    taskId: "task-1",
    generation: 1,
    state: "running",
    runRoot: "/workspace/hqbot/runs/run-1",
    outputRoot: "/workspace/hqbot/runs/run-1/output",
    scriptPath: "/workspace/hqbot/runs/run-1/command.sh",
    staged: ["/workspace/hqbot/input/file-1/source.txt"],
    outputs: [
      {
        absolutePath: "/workspace/hqbot/runs/run-1/output/result.txt",
        fileId: "file-1",
        name: "result.txt",
        relativePath: "result.txt"
      }
    ],
    failureCount: 0,
    pollScheduleId: "poll-1",
    pollToken: 1,
    startedAt: "2026-09-01T12:00:00.000Z",
    deadlineAt: "2026-09-02T12:00:00.000Z",
    result: null,
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides
  };
}

describe("teammate work storage", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => database?.close());

  it("builds the fresh schema and can run again during an update", () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);

    migrateTeammateWork(sql);
    migrateTeammateWork(sql);

    expect(database.prepare("SELECT version FROM hqbot_work_migrations").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 }
    ]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hqbot_active_work'"
        )
        .get()
    ).toEqual({ name: "hqbot_active_work" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hqbot_linux_process_v4'"
        )
        .get()
    ).toEqual({ name: "hqbot_linux_process_v4" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hqbot_external_effect_receipts'"
        )
        .get()
    ).toEqual({ name: "hqbot_external_effect_receipts" });
  });

  it("moves an existing process into the cancellation-safe table", () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateTeammateWork(sql);
    database.exec(
      "DELETE FROM hqbot_work_migrations WHERE version = 4; DROP TABLE hqbot_linux_process_v4"
    );
    const legacy = process();
    sql`INSERT INTO hqbot_linux_process (
      slot, process_id, task_id, generation, state, run_root, output_root,
      script_path, staged_json, outputs_json, failure_count, poll_schedule_id,
      poll_token, started_at, deadline_at, result_json, updated_at
    ) VALUES (
      1, ${legacy.processId}, ${legacy.taskId}, ${legacy.generation}, ${legacy.state},
      ${legacy.runRoot}, ${legacy.outputRoot}, ${legacy.scriptPath},
      ${JSON.stringify(legacy.staged)}, ${JSON.stringify(legacy.outputs)},
      ${legacy.failureCount}, ${legacy.pollScheduleId}, ${legacy.pollToken},
      ${legacy.startedAt}, ${legacy.deadlineAt}, NULL, ${legacy.updatedAt}
    )`;

    migrateTeammateWork(sql);

    const store = new TeammateLinuxProcessStore(sql);
    const upgraded = store.current();
    expect(upgraded).toMatchObject({ processId: "process-1", state: "running" });
    if (!upgraded) throw new Error("The legacy process was not migrated");
    store.put({ ...upgraded, state: "cancelling" });

    expect(store.active()).toMatchObject({ processId: "process-1", state: "cancelling" });
  });

  it("copies a version 3 process during update", () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateTeammateWork(sql);
    new TeammateLinuxProcessStore(sql).put(process());
    database.exec(
      "INSERT INTO hqbot_linux_process SELECT * FROM hqbot_linux_process_v4; " +
        "DROP TABLE hqbot_linux_process_v4; " +
        "DELETE FROM hqbot_work_migrations WHERE version = 4;"
    );

    migrateTeammateWork(sql);

    expect(new TeammateLinuxProcessStore(sql).current()).toEqual(process());
  });

  it("recovers a scheduled transition and keeps one stable submission", () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateTeammateWork(sql);
    const store = new TeammateWorkStore(sql);
    store.put(work({ generation: 1, state: "running", scheduleId: null, wakeAt: null }));

    const resumed = store.claimResume({
      taskId: "task-1",
      generation: 2,
      goal: "Research the request",
      checkpoint: "Continue with the second source",
      createdAt: "2026-09-01T12:00:00.000Z",
      predecessorGeneration: 1,
      predecessorTaskId: "task-1",
      transitionAt: "2026-09-01T12:01:00.000Z"
    });
    expect(resumed).toMatchObject({
      taskId: "task-1",
      generation: 2,
      state: "running",
      checkpoint: "Continue with the second source"
    });
    expect(store.setSubmission("task-1", 2, "task:task-1:turn:2")).toMatchObject({
      submissionId: "task:task-1:turn:2"
    });
    expect(store.setSubmission("task-1", 1, "stale")).toBeNull();
  });

  it("reconstructs a new task after the schedule-first crash gap", () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateTeammateWork(sql);
    const store = new TeammateWorkStore(sql);
    store.put(
      work({
        state: "done",
        generation: 3,
        scheduleId: null,
        wakeAt: null,
        updatedAt: "2026-09-01T12:00:00.000Z"
      })
    );

    expect(
      store.claimResume({
        taskId: "task-2",
        generation: 1,
        goal: "Prepare a report",
        checkpoint: "Start the report",
        createdAt: "2026-09-01T12:00:00.000Z",
        predecessorGeneration: 3,
        predecessorTaskId: "task-1",
        transitionAt: "2026-09-01T12:00:00.000Z"
      })
    ).toMatchObject({ taskId: "task-2", generation: 1, state: "running" });
  });

  it("keeps a terminal tombstone from reviving stale work", () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateTeammateWork(sql);
    const store = new TeammateWorkStore(sql);
    store.put(
      work({
        state: "done",
        generation: 2,
        scheduleId: null,
        wakeAt: null,
        updatedAt: "2026-09-01T12:02:00.000Z"
      })
    );

    expect(
      store.claimResume({
        taskId: "task-1",
        generation: 1,
        goal: "Research the request",
        checkpoint: "Old checkpoint",
        createdAt: "2026-09-01T12:00:00.000Z",
        predecessorGeneration: null,
        predecessorTaskId: null,
        transitionAt: "2026-09-01T12:00:00.000Z"
      })
    ).toBeNull();
    expect(store.current()).toMatchObject({ state: "done", generation: 2 });
  });

  it("does not let an awaited stale transition overwrite cancellation", () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateTeammateWork(sql);
    const store = new TeammateWorkStore(sql);
    const running = store.put(work({ state: "running" }));
    store.put(work({ state: "cancelled", generation: 2, updatedAt: "2026-09-01T12:01:00.000Z" }));

    expect(store.transition(running, work({ state: "scheduled", generation: 2 }))).toBeNull();
    expect(store.current()).toMatchObject({ state: "cancelled", generation: 2 });
  });

  it("retains one managed Linux process and its stable output IDs", () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateTeammateWork(sql);
    const store = new TeammateLinuxProcessStore(sql);

    store.put(process());
    expect(store.active()).toEqual(process());

    store.put(process({ state: "uncertain" }));
    expect(store.active()).toEqual(process({ state: "uncertain" }));

    store.put(
      process({
        state: "completed",
        result: { durationMs: 75_000, exitCode: 0, files: [], stderr: "", stdout: "done" }
      })
    );
    expect(store.active()).toBeNull();
    expect(store.current()).toMatchObject({ state: "completed", result: { stdout: "done" } });
  });
});
