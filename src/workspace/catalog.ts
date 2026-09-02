import type { BotDefinition, BotFile, BotMemory, BotSkill, BotTeammate } from "../domain/types";
import { WorkspaceAutomations } from "./automations";
import {
  botFromRow,
  fileFromRow,
  memoryFromRow,
  now,
  type Row,
  type Sql,
  skillFromRow
} from "./sql";

export class WorkspaceCatalog {
  readonly automations: WorkspaceAutomations;

  constructor(private readonly sql: Sql) {
    this.automations = new WorkspaceAutomations(sql);
  }

  createBot(
    id: string,
    definition: BotDefinition,
    brief: string,
    modelId: string,
    dailyBudgetUsd: number
  ): BotTeammate {
    const timestamp = now();
    const name = this.availableBotName(definition.name);
    const title = definition.title === definition.name ? name : definition.title;
    this.sql`INSERT INTO bots (
      id, name, title, description, brief, model_id, daily_budget_usd, created_at, updated_at
    ) VALUES (
      ${id}, ${name}, ${title}, ${definition.description}, ${brief},
      ${modelId}, ${dailyBudgetUsd}, ${timestamp}, ${timestamp}
    )`;
    return this.getBot(id) as BotTeammate;
  }

  private availableBotName(requested: string): string {
    const base = requested.trim().slice(0, 80) || "Teammate";
    const names = new Set(
      this.sql<{ name: string }>`SELECT name FROM bots`.map((row) => row.name.toLocaleLowerCase())
    );
    if (!names.has(base.toLocaleLowerCase())) return base;
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidate = `${base} ${suffix}`.slice(0, 80);
      if (!names.has(candidate.toLocaleLowerCase())) return candidate;
    }
    return `${base.slice(0, 70)} ${crypto.randomUUID().slice(0, 8)}`;
  }

  hasBot(id: string): boolean {
    return this.sql<{ id: string }>`SELECT id FROM bots WHERE id = ${id}`.length > 0;
  }

  listBots(): BotTeammate[] {
    return this.listBotsByVisibility(false);
  }

  listArchivedBots(): BotTeammate[] {
    return this.listBotsByVisibility(true);
  }

  private listBotsByVisibility(hidden: boolean): BotTeammate[] {
    return this.sql<Row>`SELECT * FROM bots
      WHERE hidden = ${hidden ? 1 : 0}
      ORDER BY pinned DESC, COALESCE(last_interacted_at, created_at) DESC`.map(botFromRow);
  }

  getBot(id: string): BotTeammate | null {
    const row = this.sql<Row>`SELECT * FROM bots WHERE id = ${id}`[0];
    return row ? botFromRow(row) : null;
  }

  updateBot(
    id: string,
    input: {
      name?: string;
      title?: string;
      description?: string;
      pinned?: boolean;
      hidden?: boolean;
      dailyBudgetUsd?: number;
      maxSteps?: number | null;
      modelId?: string;
    }
  ): BotTeammate | null {
    const current = this.getBot(id);
    if (!current) return null;
    this.sql`UPDATE bots SET
      name = ${input.name ?? current.name},
      title = ${input.title ?? current.title},
      description = ${input.description ?? current.description},
      pinned = ${(input.pinned ?? current.pinned) ? 1 : 0},
      hidden = ${(input.hidden ?? current.hidden) ? 1 : 0},
      daily_budget_usd = ${input.dailyBudgetUsd ?? current.dailyBudgetUsd},
      max_steps = ${input.maxSteps === undefined ? current.maxSteps : input.maxSteps},
      model_id = ${input.modelId ?? current.modelId},
      updated_at = ${now()}
      WHERE id = ${id}`;
    return this.getBot(id);
  }

  archiveBot(id: string): BotTeammate | null {
    const bot = this.updateBot(id, { hidden: true });
    if (!bot) return null;
    this.automations.pauseBotRoutines(id);
    return this.getBot(id);
  }

  markInteraction(id: string, message: string, status: BotTeammate["status"] = "idle"): void {
    const timestamp = now();
    this
      .sql`UPDATE bots SET last_interacted_at = ${timestamp}, last_message = ${message.slice(0, 240)},
      status = ${status}, updated_at = ${timestamp} WHERE id = ${id}`;
  }

  createMemory(id: string, botId: string, content: string): BotMemory {
    const createdAt = now();
    this.sql`INSERT INTO memories (id, bot_id, content, created_at)
      VALUES (${id}, ${botId}, ${content}, ${createdAt})`;
    return { id, botId, content, createdAt };
  }

  listMemories(botId: string): BotMemory[] {
    return this.sql<Row>`SELECT * FROM memories WHERE bot_id = ${botId}
      ORDER BY created_at ASC LIMIT 50`.map(memoryFromRow);
  }

  deleteMemory(id: string, botId: string): boolean {
    return (
      this.sql<{ id: string }>`DELETE FROM memories WHERE id = ${id} AND bot_id = ${botId}
        RETURNING id`.length > 0
    );
  }

  createFile(input: {
    id: string;
    botId: string;
    key: string;
    name: string;
    contentType: string;
    size: number;
  }): BotFile {
    const createdAt = now();
    this.sql`INSERT INTO files (
      id, bot_id, object_key, name, content_type, size, created_at
    ) VALUES (
      ${input.id}, ${input.botId}, ${input.key}, ${input.name}, ${input.contentType},
      ${input.size}, ${createdAt}
    )`;
    return { ...input, taskId: null, createdAt };
  }

  attachFiles(botId: string, taskId: string, fileIds: string[]): BotFile[] {
    const attached: BotFile[] = [];
    for (const fileId of fileIds.slice(0, 5)) {
      this.sql`UPDATE files SET task_id = ${taskId}
        WHERE id = ${fileId} AND bot_id = ${botId} AND task_id IS NULL`;
      const row = this.sql<Row>`SELECT * FROM files
        WHERE id = ${fileId} AND bot_id = ${botId} AND task_id = ${taskId}`[0];
      if (row) attached.push(fileFromRow(row));
    }
    return attached;
  }

  deleteFile(id: string, botId: string): BotFile | null {
    const row = this.sql<Row>`DELETE FROM files WHERE id = ${id} AND bot_id = ${botId}
      RETURNING *`[0];
    return row ? fileFromRow(row) : null;
  }

  listFiles(botId: string): BotFile[] {
    return this.sql<Row>`SELECT * FROM files WHERE bot_id = ${botId}
      ORDER BY created_at DESC LIMIT 30`.map(fileFromRow);
  }

  getFile(id: string, botId: string): BotFile | null {
    const row = this.sql<Row>`SELECT * FROM files WHERE id = ${id} AND bot_id = ${botId}`[0];
    return row ? fileFromRow(row) : null;
  }

  listBotArtifactKeys(botId: string): string[] {
    const files = this.sql<{ object_key: string }>`SELECT object_key FROM files
      WHERE bot_id = ${botId}`.map((row) => row.object_key);
    const screenshots = this.sql<{ screenshot_key: string | null }>`SELECT screenshot_key FROM tasks
      WHERE bot_id = ${botId} AND screenshot_key IS NOT NULL`.flatMap((row) =>
      row.screenshot_key ? [row.screenshot_key] : []
    );
    return [...new Set([...files, ...screenshots])];
  }

  deleteBot(id: string): boolean {
    if (!this.hasBot(id)) return false;
    this.sql`UPDATE usage_events SET task_id = NULL
      WHERE task_id IN (SELECT id FROM tasks WHERE bot_id = ${id})`;
    this.sql`UPDATE usage_events SET bot_id = NULL WHERE bot_id = ${id}`;
    this.sql`DELETE FROM activity WHERE task_id IN (SELECT id FROM tasks WHERE bot_id = ${id})`;
    this.sql`DELETE FROM files WHERE bot_id = ${id}`;
    this.sql`DELETE FROM tasks WHERE bot_id = ${id}`;
    this.sql`DELETE FROM memories WHERE bot_id = ${id}`;
    this.sql`DELETE FROM routines WHERE bot_id = ${id}`;
    this.sql`DELETE FROM skills WHERE bot_id = ${id}`;
    return this.sql<{ id: string }>`DELETE FROM bots WHERE id = ${id} RETURNING id`.length > 0;
  }

  createSkill(input: {
    id: string;
    botId: string;
    name: string;
    description: string;
    instructions: string;
  }): BotSkill {
    const timestamp = now();
    this.sql`INSERT INTO skills (
      id, bot_id, name, description, instructions, created_at, updated_at
    ) VALUES (
      ${input.id}, ${input.botId}, ${input.name}, ${input.description}, ${input.instructions},
      ${timestamp}, ${timestamp}
    )`;
    return { ...input, createdAt: timestamp, updatedAt: timestamp };
  }

  listSkills(botId: string): BotSkill[] {
    return this.sql<Row>`SELECT * FROM skills WHERE bot_id = ${botId}
      ORDER BY created_at ASC`.map(skillFromRow);
  }

  deleteSkill(id: string, botId: string): boolean {
    return (
      this.sql<{ id: string }>`DELETE FROM skills WHERE id = ${id} AND bot_id = ${botId}
        RETURNING id`.length > 0
    );
  }
}
