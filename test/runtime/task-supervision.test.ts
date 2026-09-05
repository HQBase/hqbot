import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import type { ActionRecord } from "../../src/domain/actions";
import { taskManagementInput } from "../../src/runtime/task-management";
import { migrateTaskSupervision, TaskSupervision } from "../../src/runtime/task-supervision";
import type { Sql, SqlValue } from "../../src/workspace/sql";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
function fixture(actions: ActionRecord[] = []) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    database
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateTaskSupervision(sql);
  migrateTaskSupervision(sql);
  const file = vi.fn().mockResolvedValue(null);
  return { supervisor: new TaskSupervision(sql, file, () => actions), file };
}
it("gives a valid completion example and keeps external evidence strict", async () => {
  const { supervisor } = fixture([
    { id: "run:1", executionId: "run", method: "search", state: "applied" } as ActionRecord,
    { id: "pending:1", method: "search", state: "approved" } as ActionRecord
  ]);
  supervisor.configure("task", "Lookup", [
    { id: "docs", description: "Lookup", actionRequired: true }
  ]);
  await expect(supervisor.verify("task", [])).rejects.toThrow('"evidence":[{"criterionId":"docs"');
  const proof = { criterionId: "docs", check: "Read the result", actionId: "run" };
  const evidence = [proof];
  await expect(supervisor.verify("task", evidence)).rejects.toThrow('"actionId":"run:1"');
  expect(evidence[0]?.actionId).toBe("run");
  await supervisor.verify("task", [{ ...proof, actionId: "run:1" }]);
  expect(supervisor.milestones("task")[0]?.state).toBe("verified");
});

it("includes the completion input shape when required fields are absent", () => {
  const parsed = taskManagementInput.safeParse({ action: "done", criteria: [], goal: "Finish" });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.message).toContain('\\"evidence\\"');
});
it("does not accept a missing deliverable or an unsupported completion claim", async () => {
  const { supervisor, file } = fixture();
  supervisor.configure("task", "Save a report", [
    { id: "report", description: "Saved report", artifactName: "report.txt" }
  ]);
  await expect(supervisor.verify("task", [])).rejects.toThrow("Verify completion criterion");
  const evidence = [{ criterionId: "report", check: "Read the saved output", artifactId: "file" }];
  await expect(supervisor.verify("task", evidence)).rejects.toThrow("missing");
  file.mockResolvedValue({ id: "file", name: "report.txt" });
  await supervisor.verify("task", evidence);
  expect(supervisor.milestones("task")[0]?.state).toBe("verified");
  expect(() =>
    supervisor.configure("task", "Save a report", [{ id: "easy", description: "Write a reply" }])
  ).toThrow("already saved");
});
it("stops unchanged checkpoints and bounds transient recovery", () => {
  const { supervisor } = fixture();
  const work = {
    taskId: "task",
    goal: "Finish",
    state: "scheduled",
    checkpoint: "No change",
    updatedAt: "2026-09-01T00:00:00Z"
  };
  expect(supervisor.observe({ ...work, generation: 0 } as never)).toBeNull();
  expect(supervisor.observe({ ...work, generation: 1 } as never)).toBeNull();
  expect(supervisor.observe({ ...work, generation: 2 } as never)).toBeNull();
  expect(supervisor.observe({ ...work, generation: 3 } as never)).toContain("no new progress");
  expect([1, 2, 3, 4].map(() => supervisor.retryDelay("task", "503 temporary failure"))).toEqual([
    5000,
    30000,
    120000,
    null
  ]);
  expect(supervisor.retryDelay("task", "403 authorization failed")).toBeNull();
});
