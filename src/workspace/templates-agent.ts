import { WorkspaceMessagesAgent } from "./messages-agent";
import { WorkspaceTemplates } from "./templates";

export class WorkspaceTemplatesAgent extends WorkspaceMessagesAgent {
  exportTemplate(botId: string, skillIds: string[], routineIds: string[]) {
    return new WorkspaceTemplates(this.db).export(botId, skillIds, routineIds);
  }
  importTemplate(id: string, value: unknown) {
    const bot = this.ctx.storage.transactionSync(() =>
      new WorkspaceTemplates(this.db).import(id, value)
    );
    this.changed();
    return bot;
  }
  publishTemplate(id: string, value: unknown) {
    return this.ctx.storage.transactionSync(() =>
      new WorkspaceTemplates(this.db).publish(id, value)
    );
  }
  listTemplateShares() {
    return new WorkspaceTemplates(this.db).list();
  }
  revokeTemplate(id: string) {
    new WorkspaceTemplates(this.db).revoke(id);
  }
  readPublicTemplate(id: string) {
    return new WorkspaceTemplates(this.db).published(id);
  }
}
