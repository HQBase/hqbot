import { Agent } from "agents"

import type {
  BotActivity,
  BotConnection,
  BotDefinition,
  BotTask,
  BotTeammate,
  StoredBotConnection,
  TaskSource,
  TaskStatus,
  WorkspaceSnapshot,
} from "./domain/types"

type SqlValue = string | number | boolean | null
type Row = Record<string, SqlValue>

function now(): string {
  return new Date().toISOString()
}

function text(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`Invalid stored ${key}`)
  return value
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === "string" ? value : null
}

function taskFromRow(row: Row): BotTask {
  return {
    id: text(row, "id"),
    botId: nullableText(row, "bot_id") ?? "legacy",
    connectionId: nullableText(row, "connection_id"),
    source: text(row, "source") as TaskSource,
    status: text(row, "status") as TaskStatus,
    prompt: text(row, "prompt"),
    subject: nullableText(row, "subject"),
    sender: nullableText(row, "sender"),
    sourceMessageId: nullableText(row, "source_message_id"),
    workflowId: nullableText(row, "workflow_id"),
    result: nullableText(row, "result"),
    replyMessageId: nullableText(row, "reply_message_id"),
    screenshotKey: nullableText(row, "screenshot_key"),
    browserUrl: nullableText(row, "browser_url"),
    error: nullableText(row, "error"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  }
}

function activityFromRow(row: Row): BotActivity {
  return {
    id: text(row, "id"),
    taskId: text(row, "task_id"),
    phase: text(row, "phase"),
    title: text(row, "title"),
    detail: nullableText(row, "detail"),
    createdAt: text(row, "created_at"),
  }
}

function publicConnection(row: Row): BotConnection {
  return {
    id: text(row, "id"),
    provider: "hqbase",
    origin: text(row, "origin"),
    mailboxId: text(row, "mailbox_id"),
    mailboxAddress: text(row, "mailbox_address"),
    mailboxName: text(row, "mailbox_name"),
    active: row.active === 1,
    createdAt: text(row, "created_at"),
  }
}

function storedConnection(row: Row): StoredBotConnection {
  return {
    ...publicConnection(row),
    botId: text(row, "bot_id"),
    tokenCiphertext: text(row, "token_ciphertext"),
    tokenIv: text(row, "token_iv"),
  }
}

function botFromRow(row: Row, connection: BotConnection | null): BotTeammate {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    title: text(row, "title"),
    description: text(row, "description"),
    brief: text(row, "brief"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    connection,
  }
}

export class HQBotAgent extends Agent<Env, Record<string, never>> {
  async onStart(): Promise<void> {
    this.sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
    const version1 = this.sql<{
      version: number
    }>`SELECT version FROM schema_migrations WHERE version = 1`
    if (version1.length === 0) {
      this.sql`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('chat', 'email')),
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        subject TEXT,
        sender TEXT,
        source_message_id TEXT UNIQUE,
        workflow_id TEXT,
        result TEXT,
        reply_message_id TEXT,
        screenshot_key TEXT,
        browser_url TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
      this.sql`CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )`
      this.sql`CREATE INDEX IF NOT EXISTS activity_task_created ON activity(task_id, created_at)`
      this.sql`INSERT INTO schema_migrations (version, applied_at) VALUES (1, ${now()})`
    }

    const version2 = this.sql<{
      version: number
    }>`SELECT version FROM schema_migrations WHERE version = 2`
    if (version2.length > 0) return
    this.sql`CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      brief TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
    this.sql`CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider = 'hqbase'),
      origin TEXT NOT NULL,
      mailbox_id TEXT NOT NULL,
      mailbox_address TEXT NOT NULL,
      mailbox_name TEXT NOT NULL,
      token_ciphertext TEXT NOT NULL,
      token_iv TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(bot_id, provider),
      UNIQUE(provider, origin, mailbox_id),
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
    )`
    const columns = this.sql<{ name: string }>`PRAGMA table_info(tasks)`
    if (!columns.some((column) => column.name === "bot_id")) {
      this.sql`ALTER TABLE tasks ADD COLUMN bot_id TEXT`
    }
    if (!columns.some((column) => column.name === "connection_id")) {
      this.sql`ALTER TABLE tasks ADD COLUMN connection_id TEXT`
    }
    this.sql`CREATE INDEX IF NOT EXISTS tasks_bot_created ON tasks(bot_id, created_at)`
    const legacyTasks = this.sql<{
      count: number
    }>`SELECT COUNT(*) AS count FROM tasks WHERE bot_id IS NULL`
    if ((legacyTasks[0]?.count ?? 0) > 0) {
      const timestamp = now()
      this.sql`INSERT OR IGNORE INTO bots (
        id, name, title, description, brief, created_at, updated_at
      ) VALUES (
        'legacy', 'HQBot', 'Research teammate',
        'I research the public web and return evidence-backed work.',
        'Legacy HQBot teammate', ${timestamp}, ${timestamp}
      )`
      this.sql`UPDATE tasks SET bot_id = 'legacy' WHERE bot_id IS NULL`
    }
    this.sql`INSERT INTO schema_migrations (version, applied_at) VALUES (2, ${now()})`
  }

  createBot(id: string, definition: BotDefinition, brief: string): BotTeammate {
    const timestamp = now()
    this.sql`INSERT INTO bots (id, name, title, description, brief, created_at, updated_at)
      VALUES (${id}, ${definition.name}, ${definition.title}, ${definition.description}, ${brief},
        ${timestamp}, ${timestamp})`
    return {
      id,
      ...definition,
      brief,
      createdAt: timestamp,
      updatedAt: timestamp,
      connection: null,
    }
  }

  hasBot(id: string): boolean {
    return this.sql<{ id: string }>`SELECT id FROM bots WHERE id = ${id}`.length > 0
  }

  connectHQBase(input: {
    id: string
    botId: string
    origin: string
    mailboxId: string
    mailboxAddress: string
    mailboxName: string
    tokenCiphertext: string
    tokenIv: string
  }): BotConnection {
    const timestamp = now()
    this.sql`INSERT INTO connections (
      id, bot_id, provider, origin, mailbox_id, mailbox_address, mailbox_name,
      token_ciphertext, token_iv, active, created_at
    ) VALUES (
      ${input.id}, ${input.botId}, 'hqbase', ${input.origin}, ${input.mailboxId},
      ${input.mailboxAddress}, ${input.mailboxName}, ${input.tokenCiphertext}, ${input.tokenIv},
      1, ${timestamp}
    )`
    return {
      id: input.id,
      provider: "hqbase",
      origin: input.origin,
      mailboxId: input.mailboxId,
      mailboxAddress: input.mailboxAddress,
      mailboxName: input.mailboxName,
      active: true,
      createdAt: timestamp,
    }
  }

  getBotConnection(connectionId: string): StoredBotConnection | null {
    const rows = this.sql<Row>`SELECT * FROM connections WHERE id = ${connectionId}`
    return rows[0] ? storedConnection(rows[0]) : null
  }

  listActiveConnections(): StoredBotConnection[] {
    return this.sql<Row>`SELECT * FROM connections WHERE active = 1 ORDER BY created_at ASC`.map(
      storedConnection,
    )
  }

  createEmailTask(input: {
    id: string
    botId: string
    connectionId: string
    messageId: string
    sender: string
    subject: string
    prompt: string
  }): boolean {
    const timestamp = now()
    const rows = this.sql<{ id: string }>`INSERT OR IGNORE INTO tasks (
      id, bot_id, connection_id, source, status, prompt, subject, sender, source_message_id,
      created_at, updated_at
    ) VALUES (
      ${input.id}, ${input.botId}, ${input.connectionId}, 'email', 'queued', ${input.prompt},
      ${input.subject}, ${input.sender}, ${input.messageId}, ${timestamp}, ${timestamp}
    ) RETURNING id`
    if (rows.length === 0) return false
    this.addActivity(
      input.id,
      "queued",
      "Email received",
      "The connected HQBase inbox sent this task.",
    )
    return true
  }

  createChatTask(id: string, botId: string, prompt: string): void {
    const timestamp = now()
    this.sql`INSERT INTO tasks (
      id, bot_id, source, status, prompt, created_at, updated_at
    ) VALUES (${id}, ${botId}, 'chat', 'queued', ${prompt}, ${timestamp}, ${timestamp})`
    this.addActivity(id, "queued", "Task queued", "Your teammate is preparing the work.")
  }

  setWorkflow(taskId: string, workflowId: string): void {
    this
      .sql`UPDATE tasks SET workflow_id = ${workflowId}, updated_at = ${now()} WHERE id = ${taskId}`
  }

  setTaskInput(
    taskId: string,
    prompt: string,
    subject: string | null,
    sender: string | null,
  ): void {
    this.sql`UPDATE tasks SET prompt = ${prompt}, subject = ${subject}, sender = ${sender},
      updated_at = ${now()} WHERE id = ${taskId}`
  }

  setStatus(taskId: string, status: TaskStatus): void {
    this.sql`UPDATE tasks SET status = ${status}, updated_at = ${now()} WHERE id = ${taskId}`
  }

  addActivity(taskId: string, phase: string, title: string, detail: string | null = null): void {
    const id = `${taskId}:${phase}`
    this.sql`INSERT OR IGNORE INTO activity (id, task_id, phase, title, detail, created_at)
      VALUES (${id}, ${taskId}, ${phase}, ${title}, ${detail}, ${now()})`
  }

  recordBrowser(taskId: string, screenshotKey: string | null, browserUrl: string | null): void {
    this.sql`UPDATE tasks SET screenshot_key = ${screenshotKey}, browser_url = ${browserUrl},
      updated_at = ${now()} WHERE id = ${taskId}`
  }

  completeTask(taskId: string, result: string, replyMessageId: string | null): void {
    this.sql`UPDATE tasks SET status = 'completed', result = ${result},
      reply_message_id = ${replyMessageId}, error = NULL, updated_at = ${now()} WHERE id = ${taskId}`
    this.addActivity(
      taskId,
      "completed",
      replyMessageId ? "Work sent" : "Work completed",
      replyMessageId ? "HQBase accepted the reply." : "The result is ready in this chat.",
    )
  }

  failTask(taskId: string, error: string): void {
    const message = error.slice(0, 500)
    this.sql`UPDATE tasks SET status = 'failed', error = ${message}, updated_at = ${now()}
      WHERE id = ${taskId}`
    this.addActivity(taskId, "failed", "Task stopped", message)
  }

  getSnapshot(botId?: string): WorkspaceSnapshot {
    const connectionRows = this.sql<Row>`SELECT * FROM connections ORDER BY created_at ASC`
    const connections = new Map(
      connectionRows.map((row) => [text(row, "bot_id"), publicConnection(row)]),
    )
    const bots = this.sql<Row>`SELECT * FROM bots ORDER BY created_at ASC`.map((row) =>
      botFromRow(row, connections.get(text(row, "id")) ?? null),
    )
    const selectedBot = bots.find((candidate) => candidate.id === botId) ?? bots[0] ?? null
    const tasks = selectedBot
      ? this.sql<Row>`SELECT * FROM tasks WHERE bot_id = ${selectedBot.id}
          ORDER BY created_at DESC LIMIT 30`.map(taskFromRow)
      : []
    const activeTask =
      tasks.find((task) => !["completed", "failed"].includes(task.status)) ?? tasks[0] ?? null
    const activity = activeTask
      ? this.sql<Row>`SELECT * FROM activity WHERE task_id = ${activeTask.id}
          ORDER BY created_at ASC`.map(activityFromRow)
      : []
    return { bots, selectedBot, tasks, activeTask, activity }
  }
}
