import { getAgentByName } from "agents";

import type { BotTeammate } from "./domain/types";
import { teammateSandbox } from "./runtime/desktop";
import type { HQBotTeammate } from "./teammate";
import { WorkspaceAgentBase } from "./workspace/agent-base";

interface BotDeletionPayload {
  artifactKeys: string[];
  id: string;
}

const deletionRetry = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 10_000 };

function durableObjectIsInactive(cause: unknown): boolean {
  return cause instanceof Error && cause.message.includes("no longer active");
}

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

    const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, id);
    await peer.suspend();
    this.tasks.cancelBotTasks(id);
    this.changed();
    return this.catalog.getBot(id);
  }

  async stopBot(id: string): Promise<boolean> {
    if (!this.catalog.hasBot(id)) return false;
    const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, id);
    await peer.stopActivity();
    this.tasks.cancelBotTasks(id);
    this.catalog.markInteraction(id, "Activity stopped", "idle");
    this.changed();
    return true;
  }

  async stopBotTask(id: string): Promise<boolean> {
    if (!this.catalog.hasBot(id)) return false;
    const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, id);
    await peer.cancelActiveTask();
    this.tasks.cancelBotTasks(id);
    this.catalog.markInteraction(id, "Task stopped", "idle");
    this.changed();
    return true;
  }

  async deleteBot(id: string): Promise<boolean> {
    if (!this.catalog.hasBot(id)) return false;
    const payload = { artifactKeys: this.catalog.listBotArtifactKeys(id), id };
    this.tasks.cancelBotTasks(id);
    await this.schedule(new Date(Date.now() + 1_000), "finishBotDeletion", payload, {
      idempotent: true,
      retry: deletionRetry
    });

    const deleted = this.catalog.deleteBot(id);
    if (deleted) this.changed();
    return deleted;
  }

  async finishBotDeletion(payload: BotDeletionPayload): Promise<void> {
    this.tasks.cancelBotTasks(payload.id);
    if (this.catalog.deleteBot(payload.id)) this.changed();

    const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, payload.id);
    let cleanupFailed = false;
    try {
      await peer.stopActivity("The owner deleted this teammate");
    } catch (cause) {
      cleanupFailed = !durableObjectIsInactive(cause);
    }

    const cleanup = await Promise.allSettled([
      this.env.SANDBOX
        ? teammateSandbox(this.env, payload.id).destroy()
        : Promise.resolve(undefined),
      this.deleteBotArtifacts(payload)
    ]);
    cleanupFailed ||= cleanup.some((result) => result.status === "rejected");
    if (!cleanupFailed) {
      try {
        await peer.destroySoon();
        return;
      } catch (cause) {
        if (durableObjectIsInactive(cause)) return;
      }
    }

    // The current one-shot schedule still exists until this callback returns.
    await this.schedule(new Date(Date.now() + 30_000), "finishBotDeletion", payload, {
      idempotent: false,
      retry: deletionRetry
    });
  }

  private async deleteBotArtifacts(payload: BotDeletionPayload): Promise<void> {
    await this.deleteArtifactPrefix(`files/${payload.id}/`);
    await this.deleteArtifactPrefix(`teammates/${payload.id}/`);
    for (let index = 0; index < payload.artifactKeys.length; index += 1_000) {
      await this.env.ARTIFACTS.delete(payload.artifactKeys.slice(index, index + 1_000));
    }
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
