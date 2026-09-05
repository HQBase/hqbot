import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { assertAgentToolPolicy, assertConnectorPolicy } from "../../src/domain/admin-policy";
import { digest } from "../../src/workspace/auth";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { WorkspaceCollaboration } from "../../src/workspace/collaboration";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";
import { WorkspaceTeam } from "../../src/workspace/team";
import { WorkspaceTeamAuth } from "../../src/workspace/team-auth";

let db: DatabaseSync;
let sql: Sql;
let auth: WorkspaceTeamAuth;
let team: WorkspaceTeam;
let projects: WorkspaceCollaboration;
let catalog: WorkspaceCatalog;
beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateWorkspace(sql);
  auth = new WorkspaceTeamAuth(sql);
  team = new WorkspaceTeam(sql);
  await auth.bootstrap("owner", "a long owner password");
  catalog = new WorkspaceCatalog(sql);
  projects = new WorkspaceCollaboration(sql);
  for (const id of ["one", "two", "outside"])
    catalog.createBot(id, { name: id, title: id, description: id }, id, "test", 2);
});
afterEach(() => db.close());
async function member(role: "member" | "viewer" | "admin" = "member") {
  const project = projects.save({ name: "Shared", botIds: ["one"] });
  const token = "test-token-" + crypto.randomUUID();
  team.invite("owner", crypto.randomUUID(), await digest(token), {
    role,
    projectIds: [project.id]
  });
  const session = await auth.accept(token, crypto.randomUUID(), "a long member password");
  const user = await auth.identify(session);
  if (!user) throw new Error("No member");
  return { user, project, session, token };
}
it("uses an invitation once and stores neither invite tokens nor raw passwords", async () => {
  const { user, token, session } = await member();
  expect(await auth.identify(session)).toMatchObject({ id: user.id, role: "member" });
  expect(await auth.validateSession(session)).toBe(false);
  await expect(auth.accept(token, "again", "a long member password")).rejects.toThrow(
    "no longer available"
  );
  expect(JSON.stringify(sql`SELECT * FROM team_users`)).not.toContain("a long member password");
  expect(JSON.stringify(sql`SELECT * FROM team_invites`)).not.toContain(token);
});
it("limits members to shared whole teammates and applies viewer read-only access", async () => {
  const { user, project } = await member();
  expect(team.canBot(user.id, "one", true)).toBe(true);
  expect(team.canBot(user.id, "outside")).toBe(false);
  expect(team.canProject(user.id, project.id, true)).toBe(true);
  team.update("owner", user.id, { role: "viewer", disabled: false, projectIds: [project.id] });
  expect(team.canBot(user.id, "one")).toBe(true);
  expect(team.canBot(user.id, "one", true)).toBe(false);
});
it("revokes sessions and stops group handoffs after membership removal", async () => {
  const { user, project, session } = await member();
  projects.send(null, {
    id: "team-work",
    projectId: project.id,
    requesterId: user.id,
    content: "Read this",
    recipientIds: ["one"]
  });
  expect(projects.delivery("team-work:one", "one")?.requesterId).toBe(user.id);
  team.update("owner", user.id, { role: "member", disabled: false, projectIds: [] });
  expect(await auth.identify(session)).toBeNull();
  expect(projects.delivery("team-work:one", "one")).toBeNull();
  projects.finish("team-work:one", "one", "Late response");
  expect(projects.messages(project.id)).toHaveLength(1);
  expect(team.auditLog().some((item) => item.action === "member.access")).toBe(true);
});
it("reserves administrator grants for the owner and revokes pending invitations", async () => {
  const { user } = await member("admin");
  expect(() =>
    team.invite(user.id, crypto.randomUUID(), "hash", { role: "admin", projectIds: [] })
  ).toThrow("Only the owner");
  const token = "invitation-token-" + crypto.randomUUID();
  const invite = team.invite(user.id, crypto.randomUUID(), await digest(token), {
    role: "viewer",
    projectIds: []
  });
  team.revoke(user.id, invite.id);
  await expect(auth.accept(token, "cancelled", "long cancelled password")).rejects.toThrow(
    "no longer available"
  );
});
it("retains owner access through team schema upgrade", async () => {
  const ownerSession = (await auth.loginAccount("owner", "a long owner password", "client")).token;
  if (!ownerSession) throw new Error("No owner session");
  db.exec(
    "DROP TABLE team_sessions; DROP TABLE team_projects; DROP TABLE team_users; DROP TABLE team_invites; DROP TABLE access_audit; DROP TABLE admin_policy; ALTER TABLE project_messages DROP COLUMN requester_id; DELETE FROM schema_migrations WHERE version=21"
  );
  migrateWorkspace(sql);
  migrateWorkspace(sql);
  expect(await auth.identify(ownerSession)).toMatchObject({ role: "owner" });
  expect(catalog.getBot("one")).not.toBeNull();
});
it("blocks network escape tools and checks exact MCP origins", () => {
  const policy = { mode: "connectors-only" as const, origins: ["https://mcp.example.com"] };
  for (const name of [
    "bash",
    "browser_evaluate",
    "desktop_keyboard",
    "computer_session",
    "local_command",
    "unknown_tool"
  ])
    expect(() => assertAgentToolPolicy(policy, name)).toThrow("Workspace policy");
  expect(() => assertAgentToolPolicy(policy, "search_memories")).not.toThrow();
  expect(() => assertConnectorPolicy(policy, "https://mcp.example.com/mcp")).not.toThrow();
  expect(() => assertConnectorPolicy(policy, "https://mcp.example.com.attacker.test/mcp")).toThrow(
    "does not allow"
  );
});
