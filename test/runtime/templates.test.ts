import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { WorkspaceKnowledge } from "../../src/workspace/knowledge";
import { migrateWorkspace } from "../../src/workspace/migrations";
import { WorkspaceRoutines } from "../../src/workspace/routines";
import type { Sql, SqlValue } from "../../src/workspace/sql";
import { WorkspaceTemplates } from "../../src/workspace/templates";

let db: DatabaseSync;
let sql: Sql;
let store: WorkspaceTemplates;
let catalog: WorkspaceCatalog;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateWorkspace(sql);
  store = new WorkspaceTemplates(sql);
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

function template() {
  catalog.createMemory("secret-memory", "bot", "Private learned fact");
  catalog.createSkill({
    id: "skill",
    botId: "bot",
    name: "Report",
    description: "A verified method",
    instructions: "Compare evidence"
  });
  const routine = new WorkspaceRoutines(sql).save({
    botId: "bot",
    name: "Morning",
    prompt: "Check sources",
    schedule: { kind: "interval", everyMinutes: 60 }
  });
  return store.export("bot", ["skill"], [routine.id]);
}
it("exports only allowed fields and selected resources", () => {
  const pack = template();
  const encoded = JSON.stringify(pack);
  expect(encoded).not.toContain("Private learned fact");
  expect(encoded).not.toContain("video-bot");
  expect(encoded).not.toContain("object_key");
  expect(pack.skills).toHaveLength(1);
  expect(pack.routines).toHaveLength(1);
  expect(store.export("bot", [], []).skills).toEqual([]);
  expect(() => store.export("bot", ["foreign"], [])).toThrow("no longer available");
});
it("imports once with drafts, paused routines, and a separate budget", () => {
  const pack = template();
  const id = crypto.randomUUID();
  const bot = store.import(id, pack);
  if (!bot) throw new Error("Imported teammate missing");
  expect(bot?.id).not.toBe("bot");
  expect(store.import(id, pack)?.id).toBe(bot?.id);
  expect(catalog.listMemories(bot.id)).toHaveLength(0);
  expect(catalog.listFiles(bot.id)).toHaveLength(0);
  expect(new WorkspaceKnowledge(sql).list(bot.id)[0]).toMatchObject({ status: "draft" });
  expect(new WorkspaceRoutines(sql).list(bot.id)[0]).toMatchObject({ active: false });
  expect(() => store.import(id, { ...pack, profile: { ...pack.profile, name: "Other" } })).toThrow(
    "already in use"
  );
  catalog.deleteBot(bot.id);
  expect(() => store.import(id, pack)).toThrow("deleted");
});
it("publishes a frozen candidate and removes access on revoke", () => {
  const pack = template();
  const id = crypto.randomUUID();
  store.publish(id, pack);
  expect(store.publish(id, pack).id).toBe(id);
  catalog.updateBot("bot", { name: "Changed" });
  expect(store.published(id)?.profile.name).toBe(pack.profile.name);
  store.revoke(id);
  expect(store.published(id)).toBeNull();
  expect(store.list()).toEqual([]);
  expect(() => store.publish(id, pack)).toThrow("already in use");
  expect(
    sql<{ template_json: string }>`SELECT template_json FROM template_shares WHERE id=${id}`[0]
      ?.template_json
  ).toBe("{}");
});
it("migrates template storage and rejects invalid sizes and versions", () => {
  db.exec(
    "DROP TABLE template_imports; DROP TABLE template_shares; DELETE FROM schema_migrations WHERE version=20"
  );
  migrateWorkspace(sql);
  migrateWorkspace(sql);
  const pack = template();
  expect(() => store.import(crypto.randomUUID(), { ...pack, version: 2 })).toThrow();
  expect(() => store.import(crypto.randomUUID(), { ...pack, extra: "x".repeat(80001) })).toThrow(
    "80 KB"
  );
  expect(catalog.listBots()).toHaveLength(2);
});
