import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Sql, SqlValue } from "../../src/workspace/sql";
import { WorkspaceTasks } from "../../src/workspace/tasks";

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

describe("workspace reply approval state", () => {
  let database: DatabaseSync;
  let tasks: WorkspaceTasks;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE activity (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
    `);
    tasks = new WorkspaceTasks(sqlFor(database));
  });

  afterEach(() => database.close());

  it("stores a draft and moves an email task into approval", () => {
    database
      .prepare("INSERT INTO tasks VALUES (?, 'email', 'working', NULL, NULL, ?)")
      .run("task-1", new Date().toISOString());

    expect(tasks.requestReplyApproval("task-1", "Useful draft")).toBe(true);
    expect(database.prepare("SELECT status, result FROM tasks WHERE id = ?").get("task-1")).toEqual(
      {
        status: "awaiting_approval",
        result: "Useful draft"
      }
    );
    expect(database.prepare("SELECT phase FROM activity WHERE task_id = ?").get("task-1")).toEqual({
      phase: "approval"
    });
  });

  it("keeps the draft and cancels a rejected reply", () => {
    database
      .prepare("INSERT INTO tasks VALUES (?, 'email', 'awaiting_approval', ?, NULL, ?)")
      .run("task-1", "Useful draft", new Date().toISOString());

    expect(tasks.rejectReply("task-1")).toBe(true);
    expect(database.prepare("SELECT status, result FROM tasks WHERE id = ?").get("task-1")).toEqual(
      {
        status: "cancelled",
        result: "Useful draft"
      }
    );
    expect(tasks.rejectReply("task-1")).toBe(false);
  });

  it("does not reopen a terminal task for a stale approval", () => {
    database
      .prepare("INSERT INTO tasks VALUES (?, 'email', 'completed', ?, NULL, ?)")
      .run("task-1", "Sent reply", new Date().toISOString());

    expect(tasks.requestReplyApproval("task-1", "Stale draft")).toBe(false);
    expect(database.prepare("SELECT status, result FROM tasks WHERE id = ?").get("task-1")).toEqual(
      {
        status: "completed",
        result: "Sent reply"
      }
    );
  });
});
