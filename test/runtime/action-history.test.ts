import { DatabaseSync } from "node:sqlite";
import type { ExecutionState } from "@cloudflare/codemode";
import { afterEach, expect, it, vi } from "vitest";
import { ActionHistory, migrateActionHistory } from "../../src/runtime/action-history";
import { rejectPendingIntegrationActions } from "../../src/runtime/integration-lifecycle";
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

it("records bulk stop and connection removal without rejecting an action that won the race", async () => {
  const { history } = fixture();
  const actions = [
    action,
    { ...action, executionId: "two" },
    { ...action, connector: "other", executionId: "three" }
  ];
  const reject = vi.fn(async ({ executionId }: { executionId: string }) => {
    if (executionId !== "two") return true;
    const saved = history.list().find((item) => item.executionId === "two");
    if (!saved) throw new Error("Missing saved approval");
    history.decide("two", 0, saved.inputHash, "approved");
    history.outcome("two", 0, "applied", { ok: true });
    return false;
  });
  expect(
    await rejectPendingIntegrationActions(
      { pending: async () => actions, reject },
      "service",
      history
    )
  ).toBe(1);
  expect(history.list().find((item) => item.executionId === "one")?.state).toBe("denied");
  expect(history.list().find((item) => item.executionId === "two")?.state).toBe("applied");
  expect(history.list().some((item) => item.executionId === "three")).toBe(false);
  expect(reject).toHaveBeenCalledTimes(2);
});

it("repairs interrupted rejection records after restart only with saved execution evidence", async () => {
  const { history, sql } = fixture();
  const ids = ["rejected", "also-pending", "applied", "paused", "missing", "approved"];
  for (const executionId of ids) await history.pending({ ...action, executionId });
  const approved = history.list().find((item) => item.executionId === "approved");
  if (!approved) throw new Error("Missing saved approval");
  history.decide("approved", 0, approved.inputHash, "approved");
  const executions = [
    { id: "rejected", status: "rejected", log: [{ seq: 0, state: "reverted" }] },
    { id: "also-pending", status: "rejected", log: [{ seq: 0, state: "pending" }] },
    { id: "applied", status: "rejected", log: [{ seq: 0, state: "applied" }] },
    { id: "paused", status: "paused", log: [{ seq: 0, state: "pending" }] },
    { id: "approved", status: "rejected", log: [{ seq: 0, state: "reverted" }] }
  ] as Pick<ExecutionState, "id" | "status" | "log">[];
  const restored = new ActionHistory(sql);
  restored.reconcileRejections(executions);
  restored.reconcileRejections(executions);
  expect(Object.fromEntries(restored.list().map((item) => [item.executionId, item.state]))).toEqual(
    {
      rejected: "denied",
      "also-pending": "denied",
      applied: "pending",
      paused: "pending",
      missing: "pending",
      approved: "approved"
    }
  );
});
