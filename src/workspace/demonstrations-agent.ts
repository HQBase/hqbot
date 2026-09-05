import { getAgentByName } from "agents";
import { demonstrationDraft, demonstrationInput } from "../domain/demonstrations";
import type { HQBotTeammate } from "../teammate";
import { WorkspaceDemonstrations } from "./demonstrations";
import { WorkspaceKnowledge } from "./knowledge";
import { WorkspacePushAgent } from "./push-agent";

export class WorkspaceDemonstrationsAgent extends WorkspacePushAgent {
  private buildingDemo = false;
  private get demonstrations() {
    return new WorkspaceDemonstrations(this.db);
  }
  override async onStart() {
    await super.onStart();
    if (this.demonstrations.pending().length) await this.wakeDemonstrations();
  }
  private wakeDemonstrations() {
    return this.schedule(1, "buildDemonstrations", {}, { idempotent: true });
  }
  listDemonstrations(botId: string) {
    return this.demonstrations.list(botId);
  }
  async saveDemonstration(input: unknown) {
    const value = demonstrationInput.parse(input);
    await this.wakeDemonstrations();
    const result = this.ctx.storage.transactionSync(() => this.demonstrations.save(value));
    this.changed();
    return result;
  }
  async retryDemonstration(id: string, botId: string) {
    await this.wakeDemonstrations();
    this.demonstrations.retry(id, botId);
    this.changed();
  }
  protected override cancelBotDeliveries(botId: string) {
    super.cancelBotDeliveries(botId);
    this.demonstrations.cancel(botId);
  }
  async buildDemonstrations() {
    if (this.buildingDemo) return;
    this.buildingDemo = true;
    try {
      const pending = this.demonstrations.pending();
      if (pending.length) await this.schedule(180, "buildDemonstrations", {}, { idempotent: true });
      for (const item of pending) {
        if (!this.getBot(item.botId) || this.getBot(item.botId)?.hidden) {
          this.demonstrations.cancel(item.botId);
          continue;
        }
        if (item.attempts >= 3) {
          this.demonstrations.fail(item.id, false);
          continue;
        }
        this.demonstrations.claim(item.id);
        try {
          const peer = await getAgentByName<Env, HQBotTeammate>(
            this.env.HQBOT_TEAMMATE,
            item.botId
          );
          const draft = demonstrationDraft.parse(await peer.describeDemonstration(item));
          this.ctx.storage.transactionSync(() => {
            if (!["queued", "building"].includes(this.demonstrations.read(item.id)?.state ?? ""))
              return;
            const skill = new WorkspaceKnowledge(this.db).save(
              item.botId,
              `demonstration:${item.id}`,
              {
                kind: "skill",
                name: item.name,
                description: draft.description,
                instructions: draft.instructions,
                status: "draft",
                source: `Recording ${item.id}; selected frames and owner notes`
              }
            );
            this.demonstrations.finish(item.id, skill.id);
          });
        } catch {
          this.demonstrations.fail(item.id, item.attempts < 2);
        }
      }
      this.changed();
    } finally {
      this.buildingDemo = false;
    }
  }
}
