import {
  type AuditEntry,
  inviteInput,
  type Principal,
  type TeamInvite,
  type TeamUser,
  teamUpdate
} from "../domain/team";
import { now, type Row, type Sql, text } from "./sql";

export class WorkspaceTeam {
  constructor(private readonly sql: Sql) {}
  principal(id: string): Principal | null {
    if (id === "owner") {
      const row = this.sql<{ username: string }>`SELECT username FROM owner WHERE id='owner'`[0];
      return row ? { id, username: row.username, role: "owner" } : null;
    }
    const row = this
      .sql<Row>`SELECT id,username,role FROM team_users WHERE id=${id} AND disabled=0`[0];
    return row
      ? { id, username: text(row, "username"), role: text(row, "role") as Principal["role"] }
      : null;
  }
  projects(id: string) {
    return this.sql<{
      project_id: string;
    }>`SELECT project_id FROM team_projects WHERE user_id=${id}`.map((row) => row.project_id);
  }
  canProject(userId: string, projectId: string, write = false) {
    const user = this.principal(userId);
    if (!user || (write && user.role === "viewer")) return false;
    if (!this.sql`SELECT id FROM projects WHERE id=${projectId}`.length) return false;
    return ["owner", "admin"].includes(user.role) || this.projects(userId).includes(projectId);
  }
  canBot(userId: string, botId: string, write = false) {
    const user = this.principal(userId);
    if (!user || (write && user.role === "viewer")) return false;
    if (!this.sql`SELECT id FROM bots WHERE id=${botId} AND hidden=0`.length) return false;
    return (
      ["owner", "admin"].includes(user.role) ||
      this
        .sql`SELECT p.bot_id FROM project_teammates p JOIN team_projects t ON t.project_id=p.project_id WHERE t.user_id=${userId} AND p.bot_id=${botId} LIMIT 1`
        .length > 0
    );
  }
  list(): TeamUser[] {
    return this
      .sql<Row>`SELECT id,username,role,disabled,created_at FROM team_users ORDER BY username`.map(
      (row) => ({
        id: text(row, "id"),
        username: text(row, "username"),
        role: text(row, "role") as TeamUser["role"],
        disabled: Number(row.disabled) === 1,
        projectIds: this.projects(text(row, "id")),
        createdAt: text(row, "created_at")
      })
    );
  }
  assertAdmin(actorId: string, adminTarget = false) {
    const actor = this.principal(actorId);
    if (
      !actor ||
      !["owner", "admin"].includes(actor.role) ||
      (adminTarget && actor.role !== "owner")
    )
      throw new Error("Only the owner can change administrator access");
  }
  assertProjects(ids: string[]) {
    for (const id of ids)
      if (!this.sql`SELECT id FROM projects WHERE id=${id}`.length)
        throw new Error("A selected project no longer exists");
  }
  update(actorId: string, id: string, value: unknown) {
    const input = teamUpdate.parse(value);
    const current = this.list().find((item) => item.id === id);
    if (!current) throw new Error("Team member not found");
    this.assertAdmin(actorId, current.role === "admin" || input.role === "admin");
    if (actorId === id) throw new Error("Ask the owner to change your own access");
    this.assertProjects(input.projectIds);
    this
      .sql`UPDATE team_users SET role=${input.role},disabled=${input.disabled ? 1 : 0} WHERE id=${id}`;
    this.sql`DELETE FROM team_projects WHERE user_id=${id}`;
    for (const projectId of new Set(input.projectIds))
      this.sql`INSERT INTO team_projects (user_id,project_id) VALUES (${id},${projectId})`;
    this.sql`DELETE FROM team_sessions WHERE user_id=${id}`;
    this.sql`DELETE FROM push_devices WHERE user_id=${id}`;
    this.audit(actorId, "member.access", id);
  }
  invite(actorId: string, id: string, tokenHash: string, value: unknown) {
    const input = inviteInput.parse(value);
    this.assertAdmin(actorId, input.role === "admin");
    this.assertProjects(input.projectIds);
    if (
      this.sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM team_invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at>${now()}`[0]
        ?.count >= 100
    )
      throw new Error("Revoke an old invitation before creating another");
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    this
      .sql`INSERT INTO team_invites (id,token_hash,role,projects_json,expires_at,created_at) VALUES (${id},${tokenHash},${input.role},${JSON.stringify([...new Set(input.projectIds)])},${expires},${now()})`;
    this.audit(actorId, "invite.create", id);
    return this.invites().find((item) => item.id === id) as TeamInvite;
  }
  invites(): TeamInvite[] {
    return this
      .sql<Row>`SELECT id,role,projects_json,expires_at,used_at,revoked_at FROM team_invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at>${now()} ORDER BY created_at DESC LIMIT 100`.map(
      (row) => ({
        id: text(row, "id"),
        role: text(row, "role") as TeamInvite["role"],
        projectIds: JSON.parse(text(row, "projects_json")),
        expiresAt: text(row, "expires_at"),
        usedAt: row.used_at ? text(row, "used_at") : null,
        revokedAt: row.revoked_at ? text(row, "revoked_at") : null
      })
    );
  }
  revoke(actorId: string, id: string) {
    const invite = this.invites().find((item) => item.id === id);
    this.assertAdmin(actorId, invite?.role === "admin");
    this.sql`UPDATE team_invites SET revoked_at=${now()} WHERE id=${id}`;
    this.audit(actorId, "invite.revoke", id);
  }
  audit(actorId: string, action: string, targetId: string) {
    this
      .sql`INSERT INTO access_audit (id,actor_id,action,target_id,created_at) VALUES (${crypto.randomUUID()},${actorId},${action.slice(0, 80)},${targetId.slice(0, 300)},${now()})`;
    this
      .sql`DELETE FROM access_audit WHERE id NOT IN (SELECT id FROM access_audit ORDER BY created_at DESC LIMIT 10000)`;
  }
  auditLog(): AuditEntry[] {
    return this.sql<Row>`SELECT * FROM access_audit ORDER BY created_at DESC LIMIT 100`.map(
      (row) => ({
        id: text(row, "id"),
        actorId: text(row, "actor_id"),
        action: text(row, "action"),
        targetId: text(row, "target_id"),
        createdAt: text(row, "created_at")
      })
    );
  }
}
