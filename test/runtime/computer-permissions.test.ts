import { DatabaseSync } from "node:sqlite";
import { tool } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ComputerPermissions } from "../../src/runtime/computer-permissions";
import { migrateTeammateWork } from "../../src/runtime/work-migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

vi.mock("@cloudflare/think", () => ({ action: (config: unknown) => ({ config }) }));
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
  migrateTeammateWork(sql);
  const host = {
    pending: vi.fn().mockResolvedValue([]),
    approve: vi.fn(),
    reject: vi.fn(),
    isActive: async () => true,
    uncertain: vi.fn(),
    beforeDecision: vi.fn().mockResolvedValue(undefined)
  };
  return { permissions: new ComputerPermissions(sql, host), host };
}
it("requires review by default and uses the explicit owner policy for computer code", async () => {
  const { permissions } = fixture();
  const execute = vi.fn().mockResolvedValue({ ok: true });
  const actions = permissions.actions({
    bash: tool({ inputSchema: z.object({ script: z.string() }), execute }),
    browser_snapshot: tool({ inputSchema: z.object({}), execute })
  });
  expect(actions.browser_snapshot).toBeUndefined();
  const action = actions.bash?.config;
  if (!action || typeof action.approval !== "function") throw new Error("Approval policy missing");
  const ctx = { toolCallId: "first", messages: [], signal: new AbortController().signal } as never;
  expect(await action.approval({ input: { script: "echo test" }, ctx })).toBe(true);
  permissions.set("allow");
  expect(await action.approval({ input: { script: "echo test" }, ctx })).toBe(false);
  expect(await action.execute({ script: "echo test" }, ctx)).toMatchObject({
    ok: true,
    actionId: "computer:first:0"
  });
  await action.execute({ script: "echo test" }, ctx);
  expect(execute).toHaveBeenCalledOnce();
});
it("rechecks a denial before executing an earlier approved computer action", async () => {
  const { permissions, host } = fixture();
  const permission = vi.fn<() => "allow" | "deny">(() => "allow");
  Object.assign(host, { permission });
  const execute = vi.fn(async () => ({ ok: true }));
  const action = permissions.actions({
    bash: tool({ inputSchema: z.object({ script: z.string() }), execute })
  }).bash?.config;
  if (!action || typeof action.approval !== "function") throw new Error("Approval policy missing");
  const ctx = {
    toolCallId: "revoked",
    messages: [],
    signal: new AbortController().signal
  } as never;
  expect(await action.approval({ input: { script: "echo test" }, ctx })).toBe(false);
  permission.mockReturnValue("deny");
  await expect(action.execute({ script: "echo test" }, ctx)).rejects.toThrow("blocks");
  expect(execute).not.toHaveBeenCalled();
});
it("rejects an old approval or changed input before dispatch", async () => {
  const { permissions, host } = fixture();
  host.pending.mockResolvedValue([
    {
      executionId: "one",
      source: "action",
      descriptor: { action: "bash", input: { script: "echo one" } }
    }
  ]);
  const pending = (await permissions.pending())[0];
  if (!pending) throw new Error("Pending action missing");
  await expect(permissions.decide("one", "different", true)).rejects.toThrow("stale");
  expect(host.approve).not.toHaveBeenCalled();
  expect(host.beforeDecision).not.toHaveBeenCalled();
  await permissions.decide("one", pending.inputHash, true);
  expect(host.approve).toHaveBeenCalledWith("one");
  expect(host.beforeDecision.mock.invocationCallOrder[0]).toBeLessThan(
    host.approve.mock.invocationCallOrder[0] ?? 0
  );
});
