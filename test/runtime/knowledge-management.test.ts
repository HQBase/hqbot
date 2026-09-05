import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { WorkspaceKnowledge } from "../../src/workspace/knowledge";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

describe("persistent knowledge changes", () => {
  let db: DatabaseSync;
  let store: WorkspaceKnowledge;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    const sql = ((strings: TemplateStringsArray, ...values: SqlValue[]) =>
      db
        .prepare(strings.join("?"))
        .all(
          ...values.map((value) => (typeof value === "boolean" ? Number(value) : value))
        )) as Sql;
    migrateWorkspace(sql);
    const catalog = new WorkspaceCatalog(sql);
    for (const id of ["one", "two"])
      catalog.createBot(id, { name: id, title: id, description: id }, id, "test", 2);
    store = new WorkspaceKnowledge(sql);
  });
  afterEach(() => db.close());
  const preference = { kind: "memory", content: "Use short reports", source: "Owner message 1" };
  it("deduplicates save replay and retains verified revisions", () => {
    const first = store.save("one", "call-1", preference);
    expect(store.save("one", "call-1", preference)).toEqual(first);
    expect(store.save("one", "call-2", preference).id).toBe(first.id);
    const second = store.save("one", "call-3", {
      ...preference,
      id: first.id,
      revision: 1,
      content: "Use short reports with sources"
    });
    expect(second.revision).toBe(2);
    expect(store.history("one", first.id).map((item) => item.revision)).toEqual([2, 1]);
    expect(() => store.save("one", "call-4", { ...preference, id: first.id, revision: 1 })).toThrow(
      "changed"
    );
    expect(store.list("one")).toHaveLength(1);
  });
  it("prevents cross-teammate changes and erases forgotten content history", () => {
    const first = store.save("one", "call-1", preference);
    expect(() => store.save("two", "call-2", { ...preference, id: first.id, revision: 1 })).toThrow(
      "not found"
    );
    expect(store.forget("two", "memory", first.id)).toBe(false);
    expect(store.forget("one", "memory", first.id)).toBe(true);
    expect(store.history("one", first.id)).toEqual([]);
    expect(() => store.save("one", "call-1", preference)).toThrow("forgotten");
  });
  it("keeps draft skills separate from tested revisions", () => {
    const first = store.save("one", "skill-1", {
      kind: "skill",
      name: "Report",
      description: "Prepare report",
      instructions: "Read data. Check totals. Save report.",
      source: "Task 1"
    });
    expect(first.status).toBe("draft");
    if (first.kind !== "skill") throw new Error("Expected a skill");
    const ready = store.save("one", "skill-2", {
      ...first,
      status: "ready",
      source: "Task 2 passed"
    });
    expect(ready).toMatchObject({ revision: 2, status: "ready" });
    expect(store.history("one", first.id)).toHaveLength(2);
  });
});
