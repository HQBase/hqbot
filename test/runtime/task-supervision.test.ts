import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { migrateTaskSupervision, TaskSupervision } from "../../src/runtime/task-supervision";
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
  migrateTaskSupervision(sql);
  migrateTaskSupervision(sql);
  const file = vi.fn().mockResolvedValue(null);
  return { supervisor: new TaskSupervision(sql, file, () => []), file };
}
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
