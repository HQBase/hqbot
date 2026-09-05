import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { WorkspaceDemonstrations } from "../../src/workspace/demonstrations";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

let db: DatabaseSync;
let sql: Sql;
let store: WorkspaceDemonstrations;
let catalog: WorkspaceCatalog;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateWorkspace(sql);
  store = new WorkspaceDemonstrations(sql);
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
const input = () => ({
  id: crypto.randomUUID(),
  botId: "bot",
  name: "Report",
  notes: "Read the totals",
  videoId: "video-bot",
  frames: [{ fileId: "frame-bot", seconds: 1 }]
});
it("preserves recorded files through upgrade and deduplicates a submitted recording", () => {
  db.exec("DROP TABLE demonstrations; DELETE FROM schema_migrations WHERE version = 18");
  migrateWorkspace(sql);
  migrateWorkspace(sql);
  expect(catalog.getFile("video-bot", "bot")).not.toBeNull();
  const value = input();
  const saved = store.save(value);
  expect(store.save(value)).toEqual(saved);
  expect(store.pending()).toHaveLength(1);
  expect(() => store.save({ ...value, notes: "Changed" })).toThrow("already in use");
});
it("rejects foreign source files and bounds draft work", () => {
  expect(() => store.save({ ...input(), frames: [{ fileId: "frame-other", seconds: 2 }] })).toThrow(
    "owned by this teammate"
  );
  expect(() => store.save({ ...input(), videoId: "video-other" })).toThrow("saved video");
  for (let i = 0; i < 3; i++) store.save(input());
  expect(() => store.save(input())).toThrow("Wait for a draft");
});
it("keeps retries bounded and does not publish a cancelled draft", () => {
  const value = input();
  store.save(value);
  store.claim(value.id);
  expect(store.read(value.id)).toMatchObject({ state: "building", attempts: 1 });
  store.fail(value.id, true);
  store.claim(value.id);
  store.fail(value.id, false);
  expect(store.read(value.id)).toMatchObject({ state: "failed", attempts: 2 });
  store.retry(value.id, "other");
  expect(store.read(value.id)?.state).toBe("failed");
  store.retry(value.id, "bot");
  store.claim(value.id);
  store.cancel("bot");
  store.finish(value.id, "late-skill");
  expect(store.read(value.id)).toMatchObject({ state: "cancelled", skillId: null });
});
it("removes the draft job if its recording is deleted", () => {
  const value = input();
  store.save(value);
  catalog.deleteFile(value.videoId, "bot");
  expect(store.read(value.id)).toBeNull();
});
