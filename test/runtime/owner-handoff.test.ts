import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { ActionHistory } from "../../src/runtime/action-history";
import { OwnerHandoffs } from "../../src/runtime/owner-handoff";
import { migrateTeammateWork } from "../../src/runtime/work-migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateTeammateWork(sql);
  const submit = vi.fn(async (_id: string, _message: string) => undefined);
  const history = new ActionHistory(sql);
  const host = {
    allowed: vi.fn(async () => true),
    teamWorkId: vi.fn(async (): Promise<string | undefined> => "task"),
    release: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => ({ ownerControl: true })),
    scheduleRecovery: vi.fn(async () => undefined),
    flush: () => history.flush(submit),
    transaction: <T>(fn: () => T) => fn()
  };
  return { db, sql, host, submit, history, handoff: new OwnerHandoffs(sql, host) };
}
it("migrates existing teammate state without losing pending approvals", () => {
  const { db, sql } = fixture();
  db.exec(
    "DROP TABLE hqbot_owner_handoffs; DELETE FROM hqbot_work_migrations WHERE version = 9; UPDATE hqbot_computer_permissions SET mode = 'allow'"
  );
  migrateTeammateWork(sql);
  migrateTeammateWork(sql);
  expect(db.prepare("SELECT mode FROM hqbot_computer_permissions").get()).toEqual({
    mode: "allow"
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM hqbot_owner_handoffs").get()).toEqual({ n: 0 });
});
it("restores a handoff after restart and submits exactly one continuation after release", async () => {
  const { sql, host, handoff, submit } = fixture();
  await handoff.record("one");
  await handoff.record("one");
  const restored = new OwnerHandoffs(sql, host);
  expect(restored.pending()?.id).toBe("one");
  host.release.mockImplementation(async () => {
    expect(submit).not.toHaveBeenCalled();
  });
  await Promise.all([restored.finish("one"), restored.finish("one")]);
  expect(host.release).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]?.[0]).toBe("handoff:one");
  expect(restored.pending()).toBeNull();
  await restored.record("one");
  expect(restored.pending()).toBeNull();
});
it("recovers an approved handoff completion after control release failed", async () => {
  const { sql, host, handoff, submit } = fixture();
  await handoff.record("one");
  host.release.mockRejectedValueOnce(new Error("temporarily unavailable"));
  await expect(handoff.finish("one")).rejects.toThrow("temporarily");
  expect(handoff.pending()?.state).toBe("resuming");
  expect(submit).not.toHaveBeenCalled();
  await new OwnerHandoffs(sql, host).recover();
  expect(submit).toHaveBeenCalledOnce();
});
it("keeps a failed continuation submission in the durable outbox", async () => {
  const { handoff, submit, history, host } = fixture();
  await handoff.record("one");
  submit.mockRejectedValueOnce(new Error("disconnected"));
  await expect(handoff.finish("one")).rejects.toThrow("disconnected");
  expect(history.hasPendingContinuation()).toBe(true);
  await host.flush();
  expect(history.hasPendingContinuation()).toBe(false);
  expect(host.release).toHaveBeenCalledOnce();
});
it("rejects old, cancelled, or replaced task handoffs without resuming", async () => {
  const { handoff, host, submit } = fixture();
  await handoff.record("one");
  await handoff.record("two");
  await expect(handoff.finish("one")).rejects.toThrow("no longer pending");
  host.teamWorkId.mockResolvedValue("other-task");
  await expect(handoff.finish("two")).rejects.toThrow("no longer resume");
  expect(submit).not.toHaveBeenCalled();
  expect(host.release).not.toHaveBeenCalled();
});
it("does not reconnect or resume when task access is revoked", async () => {
  const { handoff, host } = fixture();
  await handoff.record("one");
  host.allowed.mockResolvedValue(false);
  await expect(handoff.reconnect("one")).rejects.toThrow("no longer resume");
  expect(host.reconnect).not.toHaveBeenCalled();
});
it("reconnects only the saved pending handoff", async () => {
  const { handoff, host } = fixture();
  await handoff.record("one");
  await handoff.reconnect("one");
  expect(host.reconnect).toHaveBeenCalledOnce();
  handoff.cancel();
  await expect(handoff.finish("one")).rejects.toThrow("no longer pending");
});
it("does not mistake a completed computer action for an MCP continuation", async () => {
  const { history } = fixture();
  const action = await history.pending({
    executionId: "computer:call",
    seq: 0,
    connector: "computer",
    method: "browser_open",
    args: { url: "https://example.com" }
  });
  history.decide(action.executionId, 0, action.inputHash, "approved");
  history.outcome(action.executionId, 0, "applied", { ok: true });
  expect(history.hasPendingContinuation()).toBe(false);
  const mcp = await history.pending({
    executionId: "mcp:call",
    seq: 0,
    connector: "docs",
    method: "search",
    args: { query: "test" }
  });
  history.decide(mcp.executionId, 0, mcp.inputHash, "approved");
  expect(history.hasPendingContinuation()).toBe(true);
});
