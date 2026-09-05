import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { schemaMigrations } from "../../src/domain/schema";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { reserveModelRequest } from "../../src/workspace/model-budget";
import type { Sql, SqlValue } from "../../src/workspace/sql";
import { WorkspaceTasks } from "../../src/workspace/tasks";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
function fixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  for (const migration of schemaMigrations)
    for (const statement of migration.statements) database.exec(statement);
  const sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    database
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  const catalog = new WorkspaceCatalog(sql);
  const tasks = new WorkspaceTasks(sql);
  for (const id of ["one", "two"])
    catalog.createBot(
      id,
      { name: id, title: id, description: id },
      id,
      "@cf/zai-org/glm-5.3-flash",
      2
    );
  const reserve = (
    eventId: string,
    amount: number,
    unpriced = false,
    inputTokens = 1000,
    botId = "one"
  ) =>
    reserveModelRequest(sql, { HQBOT_GLOBAL_DAILY_BUDGET_USD: "3" } as never, catalog, tasks, {
      eventId,
      botId,
      taskId: null,
      inputTokens,
      outputTokens: 500,
      estimatedCostMicroUsd: amount * 1_000_000,
      unpriced
    });
  return { reserve, tasks };
}
it("counts in-flight reservations across teammates before starting another request", () => {
  const { reserve, tasks } = fixture();
  reserve("first", 1.5);
  reserve("first", 1.5);
  expect(tasks.getCosts("one").selectedBot.estimatedUsd).toBe(1.5);
  expect(() => reserve("next", 0.6)).toThrow("exceed");
  reserve("second", 1.5, false, 1000, "two");
  expect(() => reserve("third", 0.01, false, 1000, "two")).toThrow("budget");
});
it("limits unpriced work by tokens and reports missing prices", () => {
  const { reserve, tasks } = fixture();
  reserve("unknown", 0, true, 200_000);
  expect(tasks.getCosts("one").selectedBot).toMatchObject({
    estimatedUsd: 0,
    unpricedRequests: 1,
    pendingRequests: 1
  });
  expect(() => reserve("next", 0, true, 50_000)).toThrow("token limit");
});
