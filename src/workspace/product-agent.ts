import type { KnowledgeItem, KnowledgeWrite } from "../domain/knowledge";
import { WorkspaceAgentBase } from "./agent-base";
import { WorkspaceKnowledge } from "./knowledge";

export class WorkspaceProductAgent extends WorkspaceAgentBase {
  private get knowledge(): WorkspaceKnowledge {
    return new WorkspaceKnowledge(this.db);
  }

  listKnowledge(botId: string) {
    return this.knowledge.list(botId);
  }
  override listSkills(botId: string) {
    return this.knowledge
      .list(botId)
      .filter(
        (item): item is Extract<KnowledgeItem, { kind: "skill" }> =>
          item.kind === "skill" && item.status === "ready"
      );
  }
  knowledgeHistory(botId: string, id: string) {
    return this.knowledge.history(botId, id);
  }
  saveKnowledge(botId: string, commandId: string, input: KnowledgeWrite) {
    const saved = this.ctx.storage.transactionSync(() =>
      this.knowledge.save(botId, commandId, input)
    );
    this.changed();
    return saved;
  }
  forgetKnowledge(botId: string, kind: "memory" | "skill", id: string) {
    const removed = this.ctx.storage.transactionSync(() => this.knowledge.forget(botId, kind, id));
    this.changed();
    return removed;
  }
  override deleteMemory(id: string, botId: string) {
    return this.forgetKnowledge(botId, "memory", id);
  }
  override deleteSkill(id: string, botId: string) {
    return this.forgetKnowledge(botId, "skill", id);
  }
}
