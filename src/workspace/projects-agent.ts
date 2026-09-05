import { getAgentByName } from "agents";
import type { CollaborationRequest, ProjectInput } from "../domain/projects";
import type { HQBotTeammate } from "../teammate";
import { WorkspaceCollaboration } from "./collaboration";
import { WorkspaceProductAgent } from "./product-agent";

export class WorkspaceProjectsAgent extends WorkspaceProductAgent {
  protected get projects() {
    return new WorkspaceCollaboration(this.db);
  }
  override async onStart() {
    await super.onStart();
    if (this.projects.pending().length) await this.wakeCollaboration();
  }
  private wakeCollaboration() {
    return this.schedule(
      1,
      "deliverCollaboration",
      {},
      { idempotent: true, retry: { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 10000 } }
    );
  }
  listProjects(botId?: string) {
    return this.projects.list(botId);
  }
  saveProject(input: ProjectInput) {
    const project = this.ctx.storage.transactionSync(() => this.projects.save(input));
    this.changed();
    return project;
  }
  deleteProject(id: string) {
    const deleted = this.projects.remove(id);
    this.changed();
    return deleted;
  }
  projectMessages(
    projectId: string,
    botId?: string,
    before?: string,
    options?: { query?: string; thread?: string }
  ) {
    return this.projects.messages(projectId, botId, before, options);
  }
  projectResources(projectId: string, botId: string) {
    return this.projects.resources(projectId, botId);
  }
  async sendCollaboration(senderBotId: string | null, input: CollaborationRequest) {
    await this.wakeCollaboration();
    const message = this.ctx.storage.transactionSync(() => this.projects.send(senderBotId, input));
    this.changed();
    return message;
  }
  deliveryForBot(id: string, botId: string) {
    return this.projects.delivery(id, botId);
  }
  async finishDelivery(id: string, botId: string, content: string, failed = false) {
    await this.wakeCollaboration();
    this.ctx.storage.transactionSync(() => this.projects.finish(id, botId, content, failed));
    this.changed();
  }
  protected cancelBotDeliveries(botId: string) {
    this.projects.cancelBot(botId);
  }
  async deliverCollaboration() {
    for (const row of this.projects.pending()) {
      const job = this.projects.delivery(row.id, row.bot_id);
      if (!job) {
        this.projects.state(row.id, "cancelled");
        continue;
      }
      if (Date.now() - Date.parse(job.createdAt) > 7 * 86400000) {
        this.projects.finish(
          row.id,
          row.bot_id,
          "This queued request expired after seven days.",
          true
        );
        continue;
      }
      try {
        const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, row.bot_id);
        if (row.state === "pending") {
          const accepted = await peer.acceptCollaboration(row.id);
          this.projects.state(row.id, accepted ? "submitted" : "pending");
        } else {
          const status = await peer.collaborationStatus(row.id);
          if (status.result)
            this.projects.finish(row.id, row.bot_id, status.result.text, status.result.failed);
          else if (["aborted", "skipped", "error"].includes(status.status))
            this.projects.finish(
              row.id,
              row.bot_id,
              "This request stopped before a reply was ready. Review the teammate conversation.",
              true
            );
          else this.projects.state(row.id, "submitted");
        }
      } catch {
        this.projects.state(row.id, row.state);
      }
    }
    if (this.projects.pending().length)
      await this.schedule(10, "deliverCollaboration", {}, { idempotent: false });
    this.changed();
  }
  override listFiles(botId: string) {
    const files = [
      ...super.listFiles(botId),
      ...this.projects
        .list(botId)
        .flatMap((project) => this.projects.resources(project.id, botId).files)
    ];
    return [...new Map(files.map((file) => [file.id, file])).values()];
  }
  override getFile(id: string, botId: string) {
    return super.getFile(id, botId) ?? this.listFiles(botId).find((file) => file.id === id) ?? null;
  }
  override listSkills(botId: string) {
    const skills = [
      ...super.listSkills(botId),
      ...this.projects
        .list(botId)
        .flatMap((project) => this.projects.resources(project.id, botId).skills)
    ];
    return [...new Map(skills.map((skill) => [skill.id, skill])).values()];
  }
}
