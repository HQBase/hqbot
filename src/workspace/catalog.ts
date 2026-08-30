import type {
  BotConnection,
  BotDefinition,
  BotFile,
  BotMemory,
  BotRoutine,
  BotSkill,
  BotTeammate,
  StoredBotConnection,
  StoredComputerState
} from "../domain/types";
import {
  botFromRow,
  computerFromRow,
  fileFromRow,
  memoryFromRow,
  now,
  publicConnection,
  type Row,
  routineFromRow,
  type Sql,
  skillFromRow,
  storedConnection,
  text
} from "./sql";

export class WorkspaceCatalog {
  constructor(private readonly sql: Sql) {}

  createBot(
    id: string,
    definition: BotDefinition,
    brief: string,
    modelId: string,
    dailyBudgetUsd: number
  ): BotTeammate {
    const timestamp = now();
    this.sql`INSERT INTO bots (
      id, name, title, description, brief, model_id, daily_budget_usd, created_at, updated_at
    ) VALUES (
      ${id}, ${definition.name}, ${definition.title}, ${definition.description}, ${brief},
      ${modelId}, ${dailyBudgetUsd}, ${timestamp}, ${timestamp}
    )`;
    return this.getBot(id) as BotTeammate;
  }

  hasBot(id: string): boolean {
    return this.sql<{ id: string }>`SELECT id FROM bots WHERE id = ${id}`.length > 0;
  }

  listBots(): BotTeammate[] {
    const connectionRows = this.sql<Row>`SELECT * FROM connections ORDER BY created_at ASC`;
    const connections = new Map(
      connectionRows.map((row) => [text(row, "bot_id"), publicConnection(row)])
    );
    return this.sql<Row>`SELECT * FROM bots
      WHERE hidden = 0
      ORDER BY pinned DESC, COALESCE(last_interacted_at, created_at) DESC`.map((row) =>
      botFromRow(row, connections.get(text(row, "id")) ?? null)
    );
  }

  getBot(id: string): BotTeammate | null {
    const row = this.sql<Row>`SELECT * FROM bots WHERE id = ${id}`[0];
    if (!row) return null;
    const connection = this.sql<Row>`SELECT * FROM connections WHERE bot_id = ${id}`[0];
    return botFromRow(row, connection ? publicConnection(connection) : null);
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
      model_id = ${input.modelId ?? current.modelId},
      updated_at = ${now()}
      WHERE id = ${id}`;
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

  createRoutine(input: {
    id: string;
    botId: string;
    name: string;
    prompt: string;
    intervalMinutes: number;
    nextRunAt: string;
  }): BotRoutine {
    const timestamp = now();
    this.sql`INSERT INTO routines (
      id, bot_id, name, prompt, interval_minutes, active, next_run_at, created_at, updated_at
    ) VALUES (
      ${input.id}, ${input.botId}, ${input.name}, ${input.prompt}, ${input.intervalMinutes}, 1,
      ${input.nextRunAt}, ${timestamp}, ${timestamp}
    )`;
    return { ...input, active: true, createdAt: timestamp, updatedAt: timestamp };
  }

  listRoutines(botId: string): BotRoutine[] {
    return this.sql<Row>`SELECT * FROM routines WHERE bot_id = ${botId}
      ORDER BY created_at ASC`.map(routineFromRow);
  }

  setRoutineActive(id: string, botId: string, active: boolean): BotRoutine | null {
    this.sql`UPDATE routines SET active = ${active ? 1 : 0}, updated_at = ${now()}
      WHERE id = ${id} AND bot_id = ${botId}`;
    const row = this.sql<Row>`SELECT * FROM routines WHERE id = ${id} AND bot_id = ${botId}`[0];
    return row ? routineFromRow(row) : null;
  }

  deleteRoutine(id: string, botId: string): boolean {
    return (
      this.sql<{ id: string }>`DELETE FROM routines WHERE id = ${id} AND bot_id = ${botId}
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

  getComputerState(): StoredComputerState {
    return computerFromRow(this.sql<Row>`SELECT * FROM computer_state WHERE id = 'shared'`[0]);
  }

  saveComputerState(input: Omit<StoredComputerState, "active" | "updatedAt">): void {
    this.sql`INSERT INTO computer_state (
      id, session_id, url, screenshot_key, expires_at, cookies_ciphertext, cookies_iv, updated_at
    ) VALUES (
      'shared', ${input.sessionId}, ${input.url}, ${input.screenshotKey}, ${input.expiresAt},
      ${input.cookiesCiphertext}, ${input.cookiesIv}, ${now()}
    ) ON CONFLICT(id) DO UPDATE SET
      session_id = excluded.session_id, url = excluded.url,
      screenshot_key = excluded.screenshot_key, expires_at = excluded.expires_at,
      cookies_ciphertext = excluded.cookies_ciphertext, cookies_iv = excluded.cookies_iv,
      updated_at = excluded.updated_at`;
  }

  connectHQBase(input: {
    id: string;
    botId: string;
    origin: string;
    mailboxId: string;
    mailboxAddress: string;
    mailboxName: string;
    tokenCiphertext: string;
    tokenIv: string;
  }): BotConnection {
    const timestamp = now();
    this.sql`INSERT INTO connections (
      id, bot_id, provider, origin, mailbox_id, mailbox_address, mailbox_name,
      token_ciphertext, token_iv, active, socket_status, created_at
    ) VALUES (
      ${input.id}, ${input.botId}, 'hqbase', ${input.origin}, ${input.mailboxId},
      ${input.mailboxAddress}, ${input.mailboxName}, ${input.tokenCiphertext}, ${input.tokenIv},
      1, 'connecting', ${timestamp}
    )`;
    return publicConnection(
      this.sql<Row>`SELECT * FROM connections WHERE id = ${input.id}`[0] as Row
    );
  }

  getBotConnection(connectionId: string): StoredBotConnection | null {
    const row = this.sql<Row>`SELECT * FROM connections WHERE id = ${connectionId}`[0];
    return row ? storedConnection(row) : null;
  }

  listActiveConnections(): StoredBotConnection[] {
    return this.sql<Row>`SELECT * FROM connections WHERE active = 1 ORDER BY created_at ASC`.map(
      storedConnection
    );
  }

  setConnectionRealtime(
    id: string,
    status: BotConnection["realtimeStatus"],
    cursor?: string | null
  ): void {
    this.sql`UPDATE connections SET socket_status = ${status},
      change_cursor = COALESCE(${cursor ?? null}, change_cursor),
      last_event_at = ${status === "connected" ? now() : null} WHERE id = ${id}`;
  }

  disconnectHQBase(botId: string): boolean {
    return (
      this.sql<{ id: string }>`DELETE FROM connections
        WHERE bot_id = ${botId} AND provider = 'hqbase' RETURNING id`.length > 0
    );
  }
}
