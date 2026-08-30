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

describe("workspace cost snapshot", () => {
  let database: DatabaseSync;
  let tasks: WorkspaceTasks;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE usage_events (
        id TEXT PRIMARY KEY,
        bot_id TEXT,
        task_id TEXT,
        service TEXT NOT NULL,
        input_units REAL NOT NULL,
        output_units REAL NOT NULL,
        estimated_usd REAL NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE bots (id TEXT PRIMARY KEY);
      CREATE TABLE routines (bot_id TEXT NOT NULL, active INTEGER NOT NULL);
      CREATE TABLE tasks (bot_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE files (bot_id TEXT NOT NULL, size INTEGER NOT NULL);
    `);
    tasks = new WorkspaceTasks(sqlFor(database));
  });

  afterEach(() => database.close());

  it("separates AI tokens and browser seconds for each scope", () => {
    const today = new Date().toISOString();
    const insert = database.prepare("INSERT INTO usage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run("ai-a", "bot-a", "task-a", "workers-ai", 120, 30, 0.01, today);
    insert.run("browser-a", "bot-a", "task-a", "browser", 45, 0, 0.02, today);
    insert.run("ai-b", "bot-b", "task-b", "workers-ai", 80, 20, 0.03, today);
    database.exec(`
      INSERT INTO bots VALUES ('bot-a'), ('bot-b');
      INSERT INTO routines VALUES ('bot-a', 1), ('bot-a', 1), ('bot-b', 1), ('bot-b', 0);
      INSERT INTO tasks VALUES ('bot-a', '${today}'), ('bot-b', '${today}'),
        ('bot-b', '2020-01-01T00:00:00.000Z');
      INSERT INTO files VALUES ('bot-a', 100), ('bot-a', 200), ('bot-b', 300);
    `);

    const costs = tasks.getCosts("bot-a", "task-a", {
      durableObjectGbSecondsPerDay: 10_800,
      hqbaseRealtimeConnections: 2,
      selectedBotHqbaseRealtime: true
    });

    expect(costs.overall.estimatedUsd).toBeCloseTo(0.06);
    expect(costs.selectedBot.estimatedUsd).toBeCloseTo(0.03);
    expect(costs.selectedTask.estimatedUsd).toBeCloseTo(0.03);
    expect(costs.services.overall.workersAi).toMatchObject({
      inputUnits: 200,
      outputUnits: 50,
      estimatedUsd: 0.04
    });
    expect(costs.services.selectedBot.browser).toMatchObject({
      inputUnits: 45,
      outputUnits: 0,
      estimatedUsd: 0.02
    });
    expect(costs.services.selectedTask).toEqual(costs.services.selectedBot);
    expect(costs.platform).toEqual({
      durableObjectGbSecondsPerDay: 10_800,
      hqbaseRealtimeConnections: 2,
      selectedBotHqbaseRealtime: true,
      resources: {
        overall: {
          durableObjects: 3,
          agentSchedules: 5,
          taskSubmissionsToday: 2,
          r2FileObjects: 3,
          r2FileBytes: 600
        },
        selectedBot: {
          durableObjects: 1,
          agentSchedules: 3,
          taskSubmissionsToday: 1,
          r2FileObjects: 2,
          r2FileBytes: 300
        }
      }
    });
  });

  it("returns zero service and platform totals without usage", () => {
    expect(tasks.getCosts()).toMatchObject({
      overall: { estimatedUsd: 0, inputUnits: 0, outputUnits: 0 },
      services: {
        overall: {
          browser: { estimatedUsd: 0, inputUnits: 0, outputUnits: 0 },
          workersAi: { estimatedUsd: 0, inputUnits: 0, outputUnits: 0 }
        }
      },
      platform: {
        durableObjectGbSecondsPerDay: 0,
        hqbaseRealtimeConnections: 0,
        selectedBotHqbaseRealtime: false,
        resources: {
          overall: {
            durableObjects: 1,
            agentSchedules: 0,
            taskSubmissionsToday: 0,
            r2FileObjects: 0,
            r2FileBytes: 0
          },
          selectedBot: {
            durableObjects: 0,
            agentSchedules: 0,
            taskSubmissionsToday: 0,
            r2FileObjects: 0,
            r2FileBytes: 0
          }
        }
      }
    });
  });

  it("does not count a retried browser checkpoint twice", () => {
    const usage = {
      botId: "bot-a",
      estimatedUsd: 0.001,
      id: "browser-session:one:0:1000",
      inputUnits: 1,
      service: "browser" as const,
      taskId: "task-a"
    };

    tasks.recordUsage(usage);
    tasks.recordUsage(usage);

    expect(tasks.getCosts("bot-a", "task-a").services.selectedTask.browser).toMatchObject({
      estimatedUsd: 0.001,
      inputUnits: 1
    });
  });
});
