import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { ActionHistory, migrateActionHistory } from "../../src/runtime/action-history";
import type { Sql, SqlValue } from "../../src/workspace/sql";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
function fixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    database
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateActionHistory(sql);
  migrateActionHistory(sql);
  return { database, history: new ActionHistory(sql), sql };
}
const action = {
  executionId: "one",
  seq: 0,
  connector: "service",
  method: "read",
  args: { id: "record" }
};
it("binds an owner decision to immutable input and rejects duplicate decisions", async () => {
  const { history } = fixture();
  const pending = await history.pending(action as never);
  expect(history.decide("one", 0, "wrong input", "approved")).toBe(false);
  expect(history.decide("one", 1, pending.inputHash, "approved")).toBe(false);
  expect(history.decide("one", 0, pending.inputHash, "approved")).toBe(true);
  expect(history.decide("one", 0, pending.inputHash, "approved")).toBe(false);
  expect(history.list()[0]).toMatchObject({ args: action.args, state: "approved" });
});
it("resumes an unsent result after storage recovery with the same submission ID", async () => {
  const { history, sql } = fixture();
  history.enqueue("result:one", "saved result");
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporary unavailable"))
    .mockResolvedValue(undefined);
  await expect(history.flush(submit)).rejects.toThrow("temporary unavailable");
  await new ActionHistory(sql).flush(submit);
  await new ActionHistory(sql).flush(submit);
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit).toHaveBeenNthCalledWith(1, "result:one", "saved result");
  expect(submit).toHaveBeenNthCalledWith(2, "result:one", "saved result");
});
