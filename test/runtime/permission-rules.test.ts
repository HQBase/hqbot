import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  type PermissionRule,
  permissionRuleInput,
  resolvePermission
} from "../../src/domain/permissions";
import { PermissionRules } from "../../src/runtime/permission-rules";
import { migrateTeammateWork } from "../../src/runtime/work-migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

const base: PermissionRule = {
  id: "one",
  label: "Read a selected mailbox",
  connector: "mcp_mail",
  action: "list",
  decision: "allow",
  scope: { kind: "field", path: ["mailboxId"], value: "mine" },
  taskId: null,
  expiresAt: null,
  createdAt: "2026-01-01"
};
it("requires review for other actions, connections, or scope", () => {
  const decide = (connector: string, action: string, input: unknown) =>
    resolvePermission([base], connector, action, input, null);
  expect(decide("mcp_mail", "list", { mailboxId: "mine", query: "today" })).toBe("allow");
  expect(decide("mcp_other", "list", { mailboxId: "mine" })).toBe("review");
  expect(decide("mcp_mail", "send", { mailboxId: "mine" })).toBe("review");
  expect(decide("mcp_mail", "list", { mailboxId: "other" })).toBe("review");
  expect(decide("mcp_mail", "list", Object.create({ mailboxId: "mine" }))).toBe("review");
});
it("lets denial and review rules override an allow rule or broad computer policy", () => {
  const input = { mailboxId: "mine" };
  const review = { ...base, id: "review", decision: "review" as const };
  const deny = { ...base, id: "deny", decision: "deny" as const };
  expect(resolvePermission([base, review], "mcp_mail", "list", input, null, "allow")).toBe(
    "review"
  );
  expect(resolvePermission([deny, base, review], "mcp_mail", "list", input, null)).toBe("deny");
});
it("expires grants and binds task rules to the selected task", () => {
  const input = { mailboxId: "mine" };
  expect(
    resolvePermission(
      [{ ...base, expiresAt: "2020-01-01T00:00:00Z" }],
      "mcp_mail",
      "list",
      input,
      null
    )
  ).toBe("review");
  expect(
    resolvePermission([{ ...base, taskId: "task-1" }], "mcp_mail", "list", input, "task-2")
  ).toBe("review");
  expect(
    resolvePermission([{ ...base, taskId: "task-1" }], "mcp_mail", "list", input, "task-1")
  ).toBe("allow");
});
it("matches exact inputs and web origins without substring or prototype matching", () => {
  const exact: PermissionRule = { ...base, scope: { kind: "exact", value: { one: 1, two: 2 } } };
  expect(resolvePermission([exact], "mcp_mail", "list", { two: 2, one: 1 }, null)).toBe("allow");
  expect(resolvePermission([exact], "mcp_mail", "list", { two: 2, one: 1, three: 3 }, null)).toBe(
    "review"
  );
  const origin: PermissionRule = {
    ...base,
    scope: { kind: "origin", field: "url", origin: "https://example.com" }
  };
  expect(
    resolvePermission([origin], "mcp_mail", "list", { url: "https://example.com/page" }, null)
  ).toBe("allow");
  expect(
    resolvePermission([origin], "mcp_mail", "list", { url: "https://example.com.evil.test" }, null)
  ).toBe("review");
  expect(permissionRuleInput.safeParse({ ...origin, action: "*" }).success).toBe(false);
});
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
it("updates the version 7 schema, persists edits, and revokes rules", () => {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateTeammateWork(sql);
  db.exec("DROP TABLE hqbot_permission_rules; DELETE FROM hqbot_work_migrations WHERE version = 8");
  migrateTeammateWork(sql);
  migrateTeammateWork(sql);
  const rules = new PermissionRules(sql);
  const saved = rules.save({ ...base, id: undefined });
  expect(new PermissionRules(sql).decide("mcp_mail", "list", { mailboxId: "mine" })).toBe("allow");
  rules.save({ ...saved, decision: "deny" });
  expect(rules.decide("mcp_mail", "list", { mailboxId: "mine" })).toBe("deny");
  expect(rules.remove(saved.id)).toBe(true);
  expect(rules.decide("mcp_mail", "list", { mailboxId: "mine" })).toBe("review");
});
