import type { SearchHit } from "./domain/messages";
import { TeammateDemonstrationsRuntime } from "./teammate-demonstrations";

export abstract class TeammateMessagesRuntime extends TeammateDemonstrationsRuntime {
  async findMessages(query: string): Promise<SearchHit[]> {
    const results = await this.session.search(query.trim().slice(0, 200), { limit: 20 });
    const bot = await this.workspaceAgent.getBot(this.name);
    return results
      .filter((item) => ["user", "assistant"].includes(item.role))
      .map((item) => ({
        ...item,
        kind: "message",
        label: bot?.name ?? "Teammate",
        text: item.content.slice(0, 12000),
        botId: this.name
      }));
  }
  async readMessageText(id: string): Promise<string | null> {
    if (!id || id.length > 300) return null;
    const message = await this.session.getMessage(id);
    if (!message || !["user", "assistant"].includes(message.role)) return null;
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => String(part.text ?? ""))
      .join("\n")
      .slice(0, 20000);
  }
}
