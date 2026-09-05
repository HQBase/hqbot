import { DatabaseSync } from "node:sqlite";
import type { PendingAction } from "@cloudflare/codemode";
import { afterEach, expect, it, vi } from "vitest";
import type { PermissionDecision } from "../../src/domain/permissions";
import { ActionHistory, migrateActionHistory } from "../../src/runtime/action-history";
import { TeammateIntegrations } from "../../src/runtime/teammate-integrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

const sdk = vi.hoisted(() => ({
  runtime: { pending: vi.fn(), approve: vi.fn(), reject: vi.fn() }
}));
vi.mock("@cloudflare/codemode", () => ({
  createCodemodeRuntime: () => sdk.runtime,
  DynamicWorkerExecutor: class {},
  McpConnector: class {}
}));
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  vi.resetAllMocks();
});
function fixture(decide: (action: string, args: unknown) => PermissionDecision) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    database
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateActionHistory(sql);
  const history = new ActionHistory(sql);
  const continueTurn = vi.fn(async (_id: string, _text: string) => undefined);
  const scheduleRecovery = vi.fn(async () => undefined);
  const pending: PendingAction[] = [0, 1].map((seq) => ({
    executionId: "execution",
    seq,
    connector: "mcp_docs",
    method: seq === 0 ? "search" : "read",
    args: { source: "official" }
  }));
  sdk.runtime.pending.mockImplementation(async () => [...pending]);
  sdk.runtime.approve.mockImplementation(async ({ seq }: { seq: number }) => {
    const index = pending.findIndex((item) => item.seq === seq);
    if (index < 0) throw new Error("Stale approval");
    pending.splice(index, 1);
    return {
      status: pending.length ? "paused" : "completed",
      executionId: "execution",
      result: { found: true },
      calls: [{ seq, state: "applied", result: { found: true } }]
    };
  });
  sdk.runtime.reject.mockImplementation(async () => {
    pending.splice(0);
    return true;
  });
  const integrations = new TeammateIntegrations({
    history,
    continueTurn,
    scheduleRecovery,
    readyServers: () => [],
    isActive: async () => true,
    ctx: {} as never,
    env: {} as Env,
    loader: {} as never,
    permission: (_connector: string, action: string, args: unknown) => decide(action, args),
    markInteraction: vi.fn(async () => undefined)
  } as unknown as ConstructorParameters<typeof TeammateIntegrations>[0]);
  return { integrations, history, continueTurn, scheduleRecovery, pending };
}
it("automatically grants only matching actions and durably resumes the completed script", async () => {
  const { integrations, history, continueTurn, scheduleRecovery } = fixture(() => "allow");
  expect(await integrations.pending()).toEqual([]);
  expect(sdk.runtime.approve.mock.calls.map(([call]) => call)).toEqual([
    { executionId: "execution", seq: 0 },
    { executionId: "execution", seq: 1 }
  ]);
  expect(history.list().every((item) => item.state === "applied")).toBe(true);
  expect(continueTurn).toHaveBeenCalledOnce();
  expect(scheduleRecovery).toHaveBeenCalled();
  await integrations.pending();
  expect(sdk.runtime.approve).toHaveBeenCalledTimes(2);
});
it("keeps the next ungranted action pending for owner review", async () => {
  const { integrations, continueTurn } = fixture((action) =>
    action === "search" ? "allow" : "review"
  );
  const remaining = await integrations.pending();
  expect(remaining.map((item) => item.method)).toEqual(["read"]);
  expect(sdk.runtime.approve).toHaveBeenCalledOnce();
  expect(continueTurn).not.toHaveBeenCalled();
});
it("denies an action without applying it and passes the restriction to the agent", async () => {
  const { integrations, history, continueTurn } = fixture(() => "deny");
  expect(await integrations.pending()).toEqual([]);
  expect(sdk.runtime.approve).not.toHaveBeenCalled();
  expect(history.list()[0]?.state).toBe("denied");
  expect(continueTurn.mock.calls[0]?.[1]).toContain("Do not try to bypass");
});
