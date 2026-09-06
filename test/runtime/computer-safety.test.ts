import { DatabaseSync } from "node:sqlite";
import { tool } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ComputerPermissions } from "../../src/runtime/computer-permissions";
import { ComputerSafety } from "../../src/runtime/computer-safety";
import { migrateTeammateWork } from "../../src/runtime/work-migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

vi.mock("@cloudflare/think", () => ({ action: (config: unknown) => ({ config }) }));
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
  const page = {
    url: "https://app.example/mail",
    title: "Mail",
    target: {
      name: "Mailboxes",
      tag: "button",
      role: "tab",
      type: "button",
      href: "",
      autocomplete: "",
      form: ""
    }
  };
  const host = {
    inspect: vi.fn(async () => page),
    classify: vi.fn(async () => ({
      decision: "allow" as "allow" | "review",
      title: "Open mailboxes",
      reason: "Navigate to the mailbox list."
    })),
    ownerHasControl: vi.fn(async () => false)
  };
  const safety = new ComputerSafety(sql, host);
  const owner = {
    safety,
    pending: vi.fn().mockResolvedValue([]),
    approve: vi.fn(),
    reject: vi.fn(),
    isActive: async () => true,
    uncertain: vi.fn()
  };
  const permissions = new ComputerPermissions(sql, owner);
  return { db, sql, page, host, safety, owner, permissions };
}
it("defaults fresh teammates to autonomous and preserves saved policies on upgrade", () => {
  const { db, sql, permissions } = fixture();
  expect(permissions.get()).toBe("autonomous");
  db.exec(
    "DROP TABLE hqbot_computer_reviews; DELETE FROM hqbot_work_migrations WHERE version = 10; UPDATE hqbot_computer_permissions SET mode = 'review'"
  );
  migrateTeammateWork(sql);
  migrateTeammateWork(sql);
  expect(permissions.get()).toBe("review");
  permissions.set("allow");
  expect(permissions.get()).toBe("allow");
  permissions.set("autonomous");
  expect(permissions.get()).toBe("autonomous");
});
it("allows a named navigation target, stores its review, and avoids repeated model checks", async () => {
  const { safety, host, sql } = fixture();
  const input = { ref: "e4" };
  const [review, same] = await Promise.all([
    safety.prepare("click", "browser_click", input, "autonomous"),
    safety.prepare("click", "browser_click", input, "autonomous")
  ]);
  expect(review.view).toMatchObject({ decision: "allow", title: "Click “Mailboxes”" });
  expect(review.view.details).toContain("https://app.example/mail");
  expect(same).toEqual(review);
  expect(host.classify).toHaveBeenCalledOnce();
  const restored = new ComputerSafety(sql, host);
  expect(await restored.prepare("click", "browser_click", input, "autonomous")).toEqual(review);
  expect(host.classify).toHaveBeenCalledOnce();
  await expect(
    restored.prepare("click", "browser_click", { ref: "e5" }, "autonomous")
  ).rejects.toThrow("changed");
});
it("keeps sending behind approval and binds the decision to the current target", async () => {
  const { safety, host, page } = fixture();
  page.target.name = "Send email";
  page.target.form = "Send email";
  host.classify.mockResolvedValue({
    decision: "review",
    title: "Send email",
    reason: "This sends a message to another person."
  });
  const review = await safety.prepare("send", "browser_click", { ref: "e4" }, "autonomous");
  expect(review.view.decision).toBe("review");
  const hash = await safety.hash({ ref: "e4" }, review);
  expect(hash).toHaveLength(64);
  host.inspect.mockResolvedValue({ ...page, target: { ...page.target, name: "Delete mailbox" } });
  await expect(safety.validate("browser_click", { ref: "e4" }, review)).rejects.toThrow("changed");
});
it("requires review on classifier failure and cannot approve an unknown or secret field", async () => {
  const { safety, host, page } = fixture();
  host.classify.mockRejectedValue(new Error("Unavailable"));
  expect(
    (await safety.prepare("code", "bash", { command: "python script.py" }, "autonomous")).view
      .decision
  ).toBe("review");
  host.inspect.mockRejectedValueOnce(new Error("Stale reference"));
  const unknown = await safety.prepare("unknown", "browser_click", { ref: "e4" }, "autonomous");
  expect(unknown.view.unavailable).toBe(true);
  await expect(safety.validate("browser_click", { ref: "e4" }, unknown)).rejects.toThrow(
    "verified target"
  );
  host.inspect.mockResolvedValue({ ...page, target: { ...page.target, type: "password" } });
  expect(
    (
      await safety.prepare(
        "secret",
        "browser_type",
        { ref: "e4", text: "not-a-secret" },
        "autonomous"
      )
    ).view.unavailable
  ).toBe(true);
});
it("returns control without another approval and cannot take over an active handoff", async () => {
  const { safety, host } = fixture();
  expect(
    (await safety.prepare("done", "computer_session", { action: "take_back" }, "review")).view
      .decision
  ).toBe("allow");
  host.ownerHasControl.mockResolvedValue(true);
  await expect(
    safety.validate(
      "computer_session",
      { action: "take_back" },
      await safety.prepare("done", "computer_session", { action: "take_back" }, "review")
    )
  ).rejects.toThrow("Continue");
  expect(
    (await safety.prepare("steal", "computer_session", { action: "take_back" }, "autonomous")).view
      .unavailable
  ).toBe(true);
  expect(host.classify).not.toHaveBeenCalled();
});
it("strict mode reviews navigation and a policy change invalidates earlier automatic authority", async () => {
  const { permissions } = fixture();
  const execute = vi.fn(async () => ({ ok: true }));
  const config = permissions.actions({
    browser_click: tool({ inputSchema: z.object({ ref: z.string() }), execute })
  }).browser_click?.config;
  if (!config || typeof config.approval !== "function") throw new Error("Missing action");
  const ctx = { toolCallId: "click", messages: [], signal: new AbortController().signal } as never;
  expect(await config.approval({ input: { ref: "e4" }, ctx })).toBe(false);
  permissions.set("review");
  await expect(config.execute({ ref: "e4" }, ctx)).rejects.toThrow("requires owner approval");
  expect(execute).not.toHaveBeenCalled();
});
it("reconciles only newly allowed pending actions after the owner changes policy", async () => {
  const { permissions, owner } = fixture();
  owner.pending.mockResolvedValue([
    {
      executionId: "pause",
      source: "action",
      descriptor: { toolCallId: "nav", action: "browser_click", input: { ref: "e4" } }
    }
  ]);
  permissions.set("review");
  await permissions.reconcile();
  expect(owner.approve).not.toHaveBeenCalled();
  permissions.set("autonomous");
  await permissions.reconcile();
  expect(owner.approve).toHaveBeenCalledExactlyOnceWith("pause");
});
