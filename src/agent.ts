import { getAgentByName } from "agents";

import type { BotTeammate } from "./domain/types";
import type { HQBotTeammate } from "./teammate";
import { WorkspaceAgentBase } from "./workspace/agent-base";

export class HQBotAgent extends WorkspaceAgentBase {
  async setBotHidden(id: string, hidden: boolean): Promise<BotTeammate | null> {
    const current = this.catalog.getBot(id);
    if (!current || current.hidden === hidden) return current;
    const updated = hidden
      ? this.catalog.archiveBot(id)
      : this.catalog.updateBot(id, { hidden: false });
    if (!updated || !hidden) {
      if (updated) this.changed();
      return updated;
    }

    const cancelledTaskIds = this.tasks.cancelBotTasks(id);
    const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, id);
    await peer.suspend(cancelledTaskIds);
    this.changed();
    return this.catalog.getBot(id);
  }

  async stopBot(id: string): Promise<boolean> {
    if (!this.catalog.hasBot(id)) return false;
    const taskIds = this.tasks.cancelBotTasks(id);
    const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, id);
    await peer.stopActivity(taskIds);
    this.catalog.markInteraction(id, "Activity stopped", "idle");
    this.changed();
    return true;
  }

  async deleteBot(id: string): Promise<boolean> {
    if (!this.catalog.hasBot(id)) return false;
    const artifactKeys = this.catalog.listBotArtifactKeys(id);
    this.catalog.archiveBot(id);

    const taskIds = this.tasks.cancelBotTasks(id);
    const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, id);
    await peer.stopActivity(taskIds, "The owner deleted this teammate");
    await this.deleteArtifactPrefix(`files/${id}/`);
    await this.deleteArtifactPrefix(`teammates/${id}/`);
    for (let index = 0; index < artifactKeys.length; index += 1_000) {
      await this.env.ARTIFACTS.delete(artifactKeys.slice(index, index + 1_000));
    }
    await peer.destroySoon();

    const deleted = this.catalog.deleteBot(id);
    if (deleted) this.changed();
    return deleted;
  }

  private async deleteArtifactPrefix(prefix: string): Promise<void> {
    for (;;) {
      const page = await this.env.ARTIFACTS.list({ limit: 1_000, prefix });
      if (page.objects.length === 0) return;
      await this.env.ARTIFACTS.delete(page.objects.map((object) => object.key));
      if (!page.truncated) return;
    }
  }
}
