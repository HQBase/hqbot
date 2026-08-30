import { describe, expect, it } from "vitest";

import { schemaMigrations } from "../../src/domain/schema";
import { checkSpendPolicy, positiveNumber } from "../../src/workspace/budgets";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql } from "../../src/workspace/sql";

interface PolicyInput {
  botExists?: boolean;
  hidden?: boolean;
  overall?: number;
  bot?: number;
  task?: number;
  taskCount?: number;
  globalBudget?: string;
  botBudget?: number;
  taskBudget?: string;
  taskLimit?: string;
}

function policy(input: PolicyInput = {}) {
  const env = {
    HQBOT_GLOBAL_DAILY_BUDGET_USD: input.globalBudget ?? "5",
    HQBOT_TASK_BUDGET_USD: input.taskBudget ?? "1",
    HQBOT_DAILY_TASK_LIMIT: input.taskLimit ?? "50"
  } as Parameters<typeof checkSpendPolicy>[0];
  const catalog = {
    getBot: () =>
      input.botExists === false
        ? null
        : { dailyBudgetUsd: input.botBudget ?? 2, hidden: input.hidden ?? false }
  } as unknown as Parameters<typeof checkSpendPolicy>[1];
  const tasks = {
    getCosts: () => ({
      overall: { estimatedUsd: input.overall ?? 0, inputUnits: 0, outputUnits: 0 },
      selectedBot: { estimatedUsd: input.bot ?? 0, inputUnits: 0, outputUnits: 0 },
      selectedTask: { estimatedUsd: input.task ?? 0, inputUnits: 0, outputUnits: 0 },
      dayStartedAt: "2026-08-30T00:00:00.000Z"
    }),
    countTasksSince: () => input.taskCount ?? 1
  } as unknown as Parameters<typeof checkSpendPolicy>[2];
  return checkSpendPolicy(env, catalog, tasks, "bot", "task");
}

describe("spend policy", () => {
  it.each([
    [{ botExists: false }, "The teammate is not available"],
    [{ hidden: true }, "Restore this teammate before you start new work"],
    [{ overall: 5 }, "The overall daily cost budget has been reached"],
    [{ bot: 2 }, "The teammate daily cost budget has been reached"],
    [{ task: 1 }, "The task cost budget has been reached"],
    [{ taskCount: 51 }, "The daily task limit has been reached"]
  ] as const)("blocks work at a configured boundary", (input, reason) => {
    expect(policy(input)).toEqual({ allowed: false, reason });
  });

  it("allows work below all limits and uses safe numeric fallbacks", () => {
    expect(policy({ overall: 4.99, bot: 1.99, task: 0.99, taskCount: 50 })).toEqual({
      allowed: true,
      reason: null
    });
    expect(positiveNumber("0", 2)).toBe(2);
    expect(positiveNumber("not-a-number", 5)).toBe(5);
  });
});

describe("schema v5", () => {
  it("keeps the product schema and runtime migration safeguards", () => {
    const versionFive = schemaMigrations.find((migration) => migration.version === 5);
    expect(versionFive).toBeDefined();
    const declared = versionFive?.statements.join("\n") ?? "";
    for (const invariant of [
      "daily_budget_usd REAL NOT NULL DEFAULT 2",
      "submission_id TEXT",
      "CREATE TABLE IF NOT EXISTS owner",
      "CREATE TABLE IF NOT EXISTS owner_sessions",
      "CREATE TABLE IF NOT EXISTS usage_events",
      "estimated_usd REAL NOT NULL",
      "CREATE INDEX IF NOT EXISTS usage_day"
    ]) {
      expect(declared).toContain(invariant);
    }

    const executed: string[] = [];
    const fakeSql = ((strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      executed.push(statement);
      return statement.includes("COUNT(*) AS count") ? [{ count: 0 }] : [];
    }) as unknown as Sql;
    migrateWorkspace(fakeSql);
    const runtime = executed.join("\n");
    expect(runtime).toContain("daily_budget_usd REAL NOT NULL DEFAULT 2");
    expect(runtime).toContain("CREATE TABLE IF NOT EXISTS usage_events");
    expect(runtime).toContain("CREATE INDEX IF NOT EXISTS usage_day");
  });
});

describe("schema v6", () => {
  it("adds persistent sign-in attempt limits", () => {
    const versionSix = schemaMigrations.find((migration) => migration.version === 6);
    const declared = versionSix?.statements.join("\n") ?? "";

    expect(declared).toContain("CREATE TABLE IF NOT EXISTS login_limits");
    expect(declared).toContain("blocked_until TEXT");
    expect(declared).toContain("CREATE INDEX IF NOT EXISTS login_limits_updated");
  });
});
