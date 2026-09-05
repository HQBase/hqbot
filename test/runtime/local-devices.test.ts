import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { WorkspaceLocalDevices } from "../../src/workspace/local-devices";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

let db: DatabaseSync;
let sql: Sql;
let store: WorkspaceLocalDevices;
let device: string;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((v) => (typeof v === "boolean" ? Number(v) : v)))) as Sql;
  migrateWorkspace(sql);
  store = new WorkspaceLocalDevices(sql);
  const catalog = new WorkspaceCatalog(sql);
  for (const id of ["bot", "other"])
    catalog.createBot(id, { name: id, title: id, description: id }, id, "test", 2);
  store.createPairing("code-hash", ["bot"]);
  device = store.pair("code-hash", "token-hash", "My Mac");
});
afterEach(() => db.close());
const queue = (id = "job") =>
  store.queue("bot", "task", id, { deviceId: device, command: "pwd", directory: "" });
it("pairs once and grants only selected teammates", () => {
  expect(store.identify("token-hash")).toBe(device);
  expect(() => store.pair("code-hash", "other-token", "Other")).toThrow("already used");
  expect(() => store.queue("other", null, "wrong", { deviceId: device, command: "pwd" })).toThrow(
    "not paired"
  );
  expect(() =>
    store.queue("bot", null, "escape", { deviceId: device, command: "pwd", directory: "../" })
  ).toThrow();
});
it("claims once, rejects a second start, and settles an exact result once", () => {
  queue();
  expect(queue()?.id).toBe("job");
  expect(() => store.queue("bot", null, "job", { deviceId: device, command: "other" })).toThrow(
    "already in use"
  );
  const claimId = crypto.randomUUID();
  store.claim(device, "job", claimId);
  store.claim(device, "job", claimId);
  expect(store.poll(device)).toEqual([]);
  expect(() => store.claim(device, "job", crypto.randomUUID())).toThrow("already claimed");
  store.start(device, "job", claimId);
  expect(() => store.start(device, "job", claimId)).toThrow("cannot start");
  const result = { id: "job", claimId, state: "completed", result: "/workspace" };
  store.finish(device, result);
  store.finish(device, result);
  expect(store.pendingResults()).toHaveLength(1);
  expect(store.resultAllowed("bot", "job")).toBe(true);
  expect(store.resultAllowed("other", "job")).toBe(false);
  store.delivered("job");
  expect(store.pendingResults()).toHaveLength(0);
});
it("cancels queued and late result work on stop or device removal", () => {
  queue();
  const claim = crypto.randomUUID();
  store.claim(device, "job", claim);
  store.cancelBot("bot");
  expect(() => store.start(device, "job", claim)).toThrow();
  expect(() =>
    store.finish(device, { id: "job", claimId: claim, state: "completed", result: "late" })
  ).toThrow("stopped");
  queue("next");
  const next = crypto.randomUUID();
  store.claim(device, "next", next);
  store.finish(device, { id: "next", claimId: next, state: "denied", result: "No" });
  store.revoke(device);
  expect(store.pendingResults()).toHaveLength(0);
  expect(store.resultAllowed("bot", "next")).toBe(false);
  expect(store.identify("token-hash")).toBeNull();
});
it("never requeues an uncertain command after recovery", () => {
  queue();
  store.claim(device, "job", crypto.randomUUID());
  sql`UPDATE local_jobs SET updated_at='2020-01-01' WHERE id='job'`;
  store.recovery();
  expect(store.read("job")?.state).toBe("uncertain");
  expect(store.poll(device)).toEqual([]);
  expect(store.pendingResults()).toHaveLength(1);
});
it("upgrades from schema 21 without changing teammates", () => {
  db.exec(
    "DROP TABLE local_jobs; DROP TABLE local_device_bots; DROP TABLE local_devices; DROP TABLE local_pairings; DELETE FROM schema_migrations WHERE version=22"
  );
  migrateWorkspace(sql);
  migrateWorkspace(sql);
  expect(new WorkspaceCatalog(sql).listBots()).toHaveLength(2);
  expect(store.list()).toEqual([]);
});
