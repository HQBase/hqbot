import { z } from "zod";
import { derive, digest, equal, randomToken, WorkspaceAuth } from "./auth";
import { now, type Row, text } from "./sql";
import { WorkspaceTeam } from "./team";

export class WorkspaceTeamAuth extends WorkspaceAuth {
  async identify(token: string) {
    if (await this.validateSession(token)) return new WorkspaceTeam(this.sql).principal("owner");
    if (token.length < 32 || token.length > 256) return null;
    const hash = await digest(token);
    const row = this.sql<{
      user_id: string;
    }>`SELECT user_id FROM team_sessions WHERE token_hash=${hash} AND expires_at>${now()}`[0];
    return row ? new WorkspaceTeam(this.sql).principal(row.user_id) : null;
  }
  async loginAccount(username: string, password: string, key: string) {
    if (!this.canAttempt(key, 5)) return { token: null, limited: true };
    const owner = this.sql<{ username: string }>`SELECT username FROM owner WHERE id='owner'`[0];
    if (owner?.username === username) return this.login(username, password, key);
    const row = this
      .sql<Row>`SELECT * FROM team_users WHERE username=${username} COLLATE NOCASE`[0];
    const hash = await derive(password, row ? text(row, "salt") : "hqbot-unknown-user", 100000);
    if (!row || Number(row.disabled) === 1 || !equal(hash, text(row, "password_hash"))) {
      this.recordFailure(key, 5);
      return { token: null, limited: false };
    }
    this.sql`DELETE FROM login_limits WHERE key_hash=${key}`;
    return { token: await this.createTeamSession(text(row, "id")), limited: false };
  }
  private async createTeamSession(userId: string) {
    const token = randomToken(32);
    const hash = await digest(token);
    const stamp = now();
    if (!new WorkspaceTeam(this.sql).principal(userId))
      throw new Error("Account access was removed");
    this.sql`DELETE FROM team_sessions WHERE expires_at<=${stamp}`;
    this
      .sql`INSERT INTO team_sessions (token_hash,user_id,expires_at,created_at) VALUES (${hash},${userId},${new Date(Date.now() + 30 * 86400000).toISOString()},${stamp})`;
    return token;
  }
  async accept(token: string, username: string, password: string) {
    z.string().min(32).max(100).parse(token);
    z.string().trim().min(1).max(80).parse(username);
    z.string().min(12).max(128).parse(password);
    const hash = await digest(token);
    const salt = randomToken(24);
    const passwordHash = await derive(password, salt, 100000);
    const row = this
      .sql<Row>`SELECT * FROM team_invites WHERE token_hash=${hash} AND used_at IS NULL AND revoked_at IS NULL AND expires_at>${now()}`[0];
    if (!row) throw new Error("The invitation expired or is no longer available");
    if (
      this.sql`SELECT username FROM owner WHERE lower(username)=lower(${username})`.length ||
      this.sql`SELECT username FROM team_users WHERE username=${username} COLLATE NOCASE`.length
    )
      throw new Error("Choose a different username");
    const projects = JSON.parse(text(row, "projects_json")) as string[];
    const team = new WorkspaceTeam(this.sql);
    team.assertProjects(projects);
    const id = crypto.randomUUID();
    const stamp = now();
    this
      .sql`INSERT INTO team_users (id,username,role,salt,password_hash,iterations,created_at) VALUES (${id},${username},${text(row, "role")},${salt},${passwordHash},100000,${stamp})`;
    for (const projectId of projects)
      this.sql`INSERT INTO team_projects (user_id,project_id) VALUES (${id},${projectId})`;
    this.sql`UPDATE team_invites SET used_at=${stamp} WHERE id=${text(row, "id")}`;
    team.audit(id, "invite.accept", text(row, "id"));
    return this.createTeamSession(id);
  }
  override async logout(token: string) {
    await super.logout(token);
    if (token.length < 32 || token.length > 256) return;
    const hash = await digest(token);
    this.sql`DELETE FROM team_sessions WHERE token_hash=${hash}`;
  }
}
