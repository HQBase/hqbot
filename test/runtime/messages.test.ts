import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { WorkspaceMessages } from "../../src/workspace/messages";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

let db: DatabaseSync;
let sql: Sql;
let store: WorkspaceMessages;
let catalog: WorkspaceCatalog;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateWorkspace(sql);
  store = new WorkspaceMessages(sql);
  catalog = new WorkspaceCatalog(sql);
  for (const botId of ["bot", "other"]) {
    catalog.createBot(
      botId,
      { name: botId, title: "Test", description: "Test" },
      "Test",
      "test",
      2
    );
    catalog.createFile({
      id: `video-${botId}`,
      botId,
      key: `video-${botId}`,
      name: "demo.webm",
      contentType: "video/webm",
      size: 100
    });
    catalog.createFile({
      id: `frame-${botId}`,
      botId,
      key: `frame-${botId}`,
      name: "step.jpg",
      contentType: "image/jpeg",
      size: 100
    });
  }
});
afterEach(() => db.close());

const source = { kind: "bot" as const, id: "bot", messageId: "answer" };
it("migrates discussions without removing existing files", () => {
  db.exec(
    "DROP TABLE message_reactions; DROP TABLE discussion_notes; DROP TABLE message_discussions; DELETE FROM schema_migrations WHERE version=19"
  );
  migrateWorkspace(sql);
  migrateWorkspace(sql);
  expect(catalog.getFile("video-bot", "bot")).not.toBeNull();
  expect(store.read(source, "owner")).toEqual({ notes: [], reactions: [] });
});
it("sets reactions idempotently and keeps each person's choice", () => {
  store.react(source, "owner", { emoji: "👍", active: true });
  store.react(source, "owner", { emoji: "👍", active: true });
  store.react(source, "member", { emoji: "👍", active: true });
  expect(store.read(source, "owner").reactions).toEqual([{ emoji: "👍", count: 2, mine: true }]);
  store.react(source, "owner", { emoji: "👍", active: false });
  store.react(source, "owner", { emoji: "👍", active: false });
  expect(store.read(source, "owner").reactions).toEqual([{ emoji: "👍", count: 1, mine: false }]);
});
it("deduplicates notes and prevents cross-message replay", () => {
  const note = { id: crypto.randomUUID(), content: "Check the total" };
  store.addNote(source, "owner", note);
  store.addNote(source, "owner", note);
  expect(store.read(source, "owner").notes).toHaveLength(1);
  expect(() => store.addNote({ ...source, messageId: "other" }, "owner", note)).toThrow(
    "already in use"
  );
  expect(() => store.addNote(source, "other", note)).toThrow("already in use");
  catalog.deleteBot("bot");
  expect(sql`SELECT * FROM discussion_notes`).toHaveLength(0);
});
it("searches literal text and keeps private knowledge linked to its source", () => {
  catalog.createMemory("memory", "bot", "Remember 100% accuracy");
  catalog.createSkill({
    id: "skill",
    botId: "bot",
    name: "Finance",
    description: "Report",
    instructions: "Check 100% of totals"
  });
  const results = store.search("100%");
  expect(results.map((item) => item.kind).sort()).toEqual(["memory", "skill"]);
  expect(results.every((item) => item.botId === "bot")).toBe(true);
  expect(store.search("%_")).toEqual([]);
});
