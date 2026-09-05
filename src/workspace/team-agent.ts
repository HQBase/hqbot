import { type AdminPolicy, adminPolicyInput } from "../domain/admin-policy";
import { digest, randomToken } from "./auth";
import { WorkspaceTeam } from "./team";
import { WorkspaceTeamAuth } from "./team-auth";
import { WorkspaceTemplatesAgent } from "./templates-agent";

export class WorkspaceTeamAgent extends WorkspaceTemplatesAgent {
  getAdminPolicy(): AdminPolicy {
    const row = this.db<{
      policy_json: string;
    }>`SELECT policy_json FROM admin_policy WHERE id=1`[0];
    return row
      ? adminPolicyInput.parse(JSON.parse(row.policy_json))
      : { mode: "standard", origins: [] };
  }
  saveAdminPolicy(actorId: string, input: unknown) {
    if (actorId !== "owner") throw new Error("Only the owner can change network policy");
    const value = adminPolicyInput.parse(input);
    this
      .db`INSERT INTO admin_policy (id,policy_json) VALUES (1,${JSON.stringify(value)}) ON CONFLICT(id) DO UPDATE SET policy_json=excluded.policy_json`;
    new WorkspaceTeam(this.db).audit(actorId, "policy.update", "workspace");
    return value;
  }
  identifySession(token: string) {
    return new WorkspaceTeamAuth(this.db).identify(token);
  }
  loginAccount(username: string, password: string, key: string) {
    return new WorkspaceTeamAuth(this.db).loginAccount(username, password, key);
  }
  acceptInvitation(token: string, username: string, password: string) {
    return new WorkspaceTeamAuth(this.db).accept(token, username, password);
  }
  override logoutOwner(token: string) {
    return new WorkspaceTeamAuth(this.db).logout(token);
  }
  teamPrincipal(id: string) {
    return new WorkspaceTeam(this.db).principal(id);
  }
  canAccessBot(userId: string, botId: string, write = false) {
    return new WorkspaceTeam(this.db).canBot(userId, botId, write);
  }
  canAccessProject(userId: string, projectId: string, write = false) {
    return new WorkspaceTeam(this.db).canProject(userId, projectId, write);
  }
  teamAdministration(actorId: string) {
    const team = new WorkspaceTeam(this.db);
    team.assertAdmin(actorId);
    return {
      users: team.list(),
      invitations: team.invites(),
      audit: team.auditLog(),
      projects: this.listProjects()
    };
  }
  async inviteTeamMember(actorId: string, input: unknown) {
    const token = randomToken(32);
    const hash = await digest(token);
    const invitation = this.ctx.storage.transactionSync(() =>
      new WorkspaceTeam(this.db).invite(actorId, crypto.randomUUID(), hash, input)
    );
    return { invitation, token };
  }
  updateTeamMember(actorId: string, id: string, input: unknown) {
    this.ctx.storage.transactionSync(() => new WorkspaceTeam(this.db).update(actorId, id, input));
    this.changed();
  }
  revokeTeamInvite(actorId: string, id: string) {
    this.ctx.storage.transactionSync(() => new WorkspaceTeam(this.db).revoke(actorId, id));
  }
  recordAccessAudit(actorId: string, action: string, targetId: string) {
    new WorkspaceTeam(this.db).audit(actorId, action, targetId);
  }
  teamWorkspace(userId: string) {
    const team = new WorkspaceTeam(this.db);
    const user = team.principal(userId);
    if (!user) throw new Error("Sign in again to continue");
    return {
      user,
      bots: this.listBots().filter((bot) => team.canBot(userId, bot.id)),
      projects: this.listProjects().filter((project) => team.canProject(userId, project.id))
    };
  }
  protected override canNotify(userId: string, botId: string | null) {
    return userId === "owner" || Boolean(botId && this.canAccessBot(userId, botId));
  }
}
