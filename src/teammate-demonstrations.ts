import {
  type DemonstrationDraft,
  demonstrationDraft,
  demonstrationInput
} from "./domain/demonstrations";
import { GLM_PRIMARY_MODEL_ID } from "./domain/models";
import { describeRecording } from "./runtime/demonstration-draft";
import { TeammateAutomationsRuntime } from "./teammate-automations";

export abstract class TeammateDemonstrationsRuntime extends TeammateAutomationsRuntime {
  private reviewingDemo = new Map<string, Promise<DemonstrationDraft>>();
  async describeDemonstration(value: unknown): Promise<DemonstrationDraft> {
    const item = demonstrationInput.parse(value);
    if (item.botId !== this.name) throw new Error("Demonstration does not belong to this teammate");
    const saved = await this.ctx.storage.get<DemonstrationDraft>(`hqbot:demo-draft:${item.id}`);
    if (saved) return demonstrationDraft.parse(saved);
    const existing = this.reviewingDemo.get(item.id);
    if (existing) return existing;
    const run = this.reviewRecording(item);
    this.reviewingDemo.set(item.id, run);
    try {
      return await run;
    } finally {
      this.reviewingDemo.delete(item.id);
    }
  }
  private async reviewRecording(item: ReturnType<typeof demonstrationInput.parse>) {
    const bot = await this.workspaceAgent.getBot(this.name);
    if (!bot || bot.hidden) throw new Error("The teammate is not active");
    const images = [];
    for (const frame of item.frames) {
      const file = await this.workspaceAgent.getFile(frame.fileId, this.name);
      if (
        !file ||
        file.botId !== this.name ||
        !["image/jpeg", "image/png"].includes(file.contentType) ||
        file.size > 500000
      )
        throw new Error("A selected frame is unavailable");
      const object = await this.env.ARTIFACTS.get(file.key);
      if (!object || object.size > 500000) throw new Error("A selected frame is unavailable");
      images.push({
        seconds: frame.seconds,
        data: new Uint8Array(await object.arrayBuffer()),
        mediaType: file.contentType
      });
    }
    const draft = await describeRecording(
      this.budgetedModelFor(GLM_PRIMARY_MODEL_ID, () => null),
      item,
      images
    );
    await this.ctx.storage.put(`hqbot:demo-draft:${item.id}`, draft);
    return draft;
  }
}
