import { type KnowledgeItem, type KnowledgeVersion, knowledgeWrite } from "../domain/knowledge";
import { WorkspaceCatalog } from "./catalog";
import { memoryFromRow, now, type Row, type Sql, skillFromRow } from "./sql";

export class WorkspaceKnowledge {
  private readonly catalog: WorkspaceCatalog;
  constructor(private readonly sql: Sql) {
    this.catalog = new WorkspaceCatalog(sql);
  }

  list(botId: string): KnowledgeItem[] {
    return [
      ...this.sql<Row>`SELECT * FROM memories WHERE bot_id = ${botId}`.map((row) => ({
        ...memoryFromRow(row),
        kind: "memory" as const
      })),
      ...this.sql<Row>`SELECT * FROM skills WHERE bot_id = ${botId}`.map((row) => ({
        ...skillFromRow(row),
        kind: "skill" as const
      }))
    ]
      .map((item) => this.decorate(item))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private decorate(
    item: Omit<KnowledgeItem, "revision" | "source" | "category" | "status" | "updatedAt">
  ): KnowledgeItem {
    const meta = this
      .sql<Row>`SELECT * FROM knowledge_metadata WHERE item_id = ${item.id} AND bot_id = ${item.botId}`[0];
    return {
      ...item,
      revision: Number(meta?.revision ?? 1),
      source: String(meta?.source ?? "Saved by owner"),
      category: String(meta?.category ?? (item.kind === "memory" ? "preference" : "method")),
      status: meta?.status === "draft" ? "draft" : "ready",
      updatedAt: String(meta?.updated_at ?? item.createdAt)
    } as KnowledgeItem;
  }

  save(botId: string, commandId: string, value: unknown): KnowledgeItem {
    const input = knowledgeWrite.parse(value);
    if (!commandId || commandId.length > 200) throw new Error("A valid save ID is required");
    const bot = this.catalog.getBot(botId);
    if (!bot || bot.hidden) throw new Error("Restore this teammate before saving knowledge");
    const prior = this.sql<{
      item_id: string;
      kind: string;
      bot_id: string;
    }>`SELECT item_id, kind, bot_id FROM knowledge_commands WHERE id = ${commandId}`[0];
    if (prior) {
      if (
        prior.bot_id !== botId ||
        prior.kind !== input.kind ||
        (input.id && input.id !== prior.item_id)
      )
        throw new Error("This save ID belongs to another change");
      const replay = this.list(botId).find((item) => item.id === prior.item_id);
      if (!replay)
        throw new Error("This entry was forgotten. Start a new save to remember it again.");
      return replay;
    }
    const items = this.list(botId);
    const current = input.id
      ? items.find((item) => item.id === input.id && item.kind === input.kind)
      : undefined;
    if (input.id && !current) throw new Error("Knowledge entry not found");
    if (current && input.revision !== current.revision)
      throw new Error("This entry changed. Read the latest revision before saving.");
    const duplicate = !input.id
      ? items.find((item) =>
          input.kind === "memory" && item.kind === "memory"
            ? item.content.trim().toLocaleLowerCase() === input.content.toLocaleLowerCase()
            : input.kind === "skill" &&
              item.kind === "skill" &&
              item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase()
        )
      : undefined;
    if (duplicate && input.kind === "skill")
      throw new Error("A skill with this name exists. Revise that skill instead.");
    if (duplicate) {
      this.command(commandId, botId, duplicate.id, input.kind);
      return duplicate;
    }
    const timestamp = now();
    const id = current?.id ?? crypto.randomUUID();
    if (current) this.version(current);
    if (input.kind === "memory") {
      if (current)
        this
          .sql`UPDATE memories SET content = ${input.content} WHERE id = ${id} AND bot_id = ${botId}`;
      else this.catalog.createMemory(id, botId, input.content);
    } else if (current) {
      this
        .sql`UPDATE skills SET name = ${input.name}, description = ${input.description}, instructions = ${input.instructions}, updated_at = ${timestamp} WHERE id = ${id} AND bot_id = ${botId}`;
    } else
      this.catalog.createSkill({
        id,
        botId,
        name: input.name,
        description: input.description,
        instructions: input.instructions
      });
    this
      .sql`INSERT INTO knowledge_metadata (item_id, bot_id, kind, revision, source, category, status, updated_at)
      VALUES (${id}, ${botId}, ${input.kind}, ${(current?.revision ?? 0) + 1}, ${input.source},
      ${input.kind === "memory" ? input.category : "method"}, ${input.kind === "memory" ? "ready" : input.status}, ${timestamp})
      ON CONFLICT (item_id) DO UPDATE SET revision = excluded.revision, source = excluded.source,
      category = excluded.category, status = excluded.status, updated_at = excluded.updated_at`;
    const saved = this.list(botId).find((item) => item.id === id);
    if (!saved) throw new Error("The entry could not be read after saving");
    this.version(saved);
    this.command(commandId, botId, id, input.kind);
    return saved;
  }

  private command(id: string, botId: string, itemId: string, kind: string): void {
    this
      .sql`INSERT INTO knowledge_commands (id, bot_id, item_id, kind, created_at) VALUES (${id}, ${botId}, ${itemId}, ${kind}, ${now()})`;
  }

  private version(item: KnowledgeItem): void {
    this
      .sql`INSERT OR IGNORE INTO knowledge_versions (item_id, bot_id, revision, snapshot, created_at)
      VALUES (${item.id}, ${item.botId}, ${item.revision}, ${JSON.stringify(item)}, ${item.updatedAt})`;
  }

  history(botId: string, id: string): KnowledgeVersion[] {
    return this.sql<{
      revision: number;
      snapshot: string;
      created_at: string;
    }>`SELECT revision, snapshot, created_at FROM knowledge_versions WHERE bot_id = ${botId} AND item_id = ${id} ORDER BY revision DESC LIMIT 50`.map(
      (row) => ({
        revision: row.revision,
        createdAt: row.created_at,
        item: JSON.parse(row.snapshot) as KnowledgeItem
      })
    );
  }

  forget(botId: string, kind: "memory" | "skill", id: string): boolean {
    const found = this.list(botId).find((item) => item.id === id && item.kind === kind);
    if (!found) return false;
    if (kind === "memory") this.catalog.deleteMemory(id, botId);
    else this.catalog.deleteSkill(id, botId);
    this.sql`DELETE FROM knowledge_versions WHERE bot_id = ${botId} AND item_id = ${id}`;
    this.sql`DELETE FROM knowledge_metadata WHERE bot_id = ${botId} AND item_id = ${id}`;
    return true;
  }
}
