import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { WorkspaceEvents } from "../../src/workspace/events";
import { migrateWorkspace } from "../../src/workspace/migrations";
import { WorkspaceRoutines } from "../../src/workspace/routines";
import type { Sql, SqlValue } from "../../src/workspace/sql";

let db: DatabaseSync;
let sql: Sql;
let events: WorkspaceEvents;
let routines: WorkspaceRoutines;
let routineId: string;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateWorkspace(sql);
  events = new WorkspaceEvents(sql);
  routines = new WorkspaceRoutines(sql);
  new WorkspaceCatalog(sql).createBot(
    "bot",
    { name: "Bot", title: "Test", description: "Test" },
    "Test",
    "test",
    2
  );
  routineId = routines.save({
    botId: "bot",
    name: "Inbound",
    prompt: "Read the event",
    schedule: { kind: "event" }
  }).id;
});
afterEach(() => db.close());
const input = () => ({
  id: crypto.randomUUID(),
  botId: "bot",
  routineId,
  name: "Tickets",
  filter: { provider: "generic", eventType: "" }
});
const event = { id: "delivery-1", digest: "digest-1", body: { text: "Hello" }, ignored: false };
it("migrates existing routines and keeps secrets out of listings", () => {
  db.exec(
    "DROP TABLE event_receipts; DROP TABLE event_triggers; DELETE FROM schema_migrations WHERE version = 16"
  );
  migrateWorkspace(sql);
  migrateWorkspace(sql);
  expect(routines.list("bot")).toHaveLength(1);
  const saved = events.save(input());
  expect(saved.secret).toHaveLength(64);
  expect(JSON.stringify(events.list(routineId))).not.toContain(saved.secret);
  const edited = events.save({ ...saved.trigger, name: "Changed" });
  expect(edited.secret).toBeUndefined();
  expect(edited.trigger.revision).toBe(2);
  expect(() => events.save({ ...saved.trigger, name: "Stale" })).toThrow("changed");
});
it("deduplicates receipts and runs without collapsing separate generic events with the same content", () => {
  const { trigger } = events.save(input());
  expect(events.accept(trigger, event).state).toBe("accepted");
  expect(events.accept(trigger, event).state).toBe("duplicate");
  expect(() => events.accept(trigger, { ...event, digest: "changed" })).toThrow("reused");
  events.accept(trigger, { ...event, id: "delivery-2" });
  expect(routines.history("bot", routineId)).toHaveLength(2);
  expect(events.history(trigger.id)).toHaveLength(2);
});
it("records ignored events without work, applies queue limits, and checks edits after verification", () => {
  const { trigger } = events.save(input());
  events.accept(trigger, { ...event, ignored: true });
  expect(routines.pending()).toEqual([]);
  for (let i = 0; i < 20; i++) routines.queue("bot", routineId, `manual-${i}`, "manual");
  expect(() => events.accept(trigger, { ...event, id: "overflow" })).toThrow("too many queued");
  expect(events.history(trigger.id)).toHaveLength(1);
  events.save({ ...trigger, enabled: false });
  expect(() => events.accept(trigger, { ...event, id: "stale" })).toThrow("changed");
});
it("requires Slack's app secret and removes receipts when the trigger is deleted", () => {
  expect(() =>
    events.save({ ...input(), filter: { provider: "slack", teamId: "T123", channelId: "C123" } })
  ).toThrow("signing secret");
  const { trigger } = events.save(input());
  events.accept(trigger, event);
  events.remove(trigger.id);
  expect(events.history(trigger.id)).toEqual([]);
  expect(events.read(trigger.id)).toBeNull();
});
