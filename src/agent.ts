import { Agent } from "agents"

import type { BotActivity, BotSnapshot, BotTask, TaskSource, TaskStatus } from "./domain/types"

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

export class HQBotAgent extends Agent<Env, Record<string, never>> {
  async onStart(): Promise<void> {
    this.sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
    const applied = this.sql<{
      version: number
    }>`SELECT version FROM schema_migrations WHERE version = 1`
    if (applied.length > 0) return
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

  createEmailTask(input: {
    id: string
    messageId: string
    sender: string
    subject: string
    prompt: string
  }): boolean {
    const timestamp = now()
    const rows = this.sql<{ id: string }>`INSERT OR IGNORE INTO tasks (
      id, source, status, prompt, subject, sender, source_message_id, created_at, updated_at
    ) VALUES (
      ${input.id}, 'email', 'queued', ${input.prompt}, ${input.subject}, ${input.sender},
      ${input.messageId}, ${timestamp}, ${timestamp}
    ) RETURNING id`
    if (rows.length === 0) return false
    this.addActivity(input.id, "queued", "Email received", "Inbox routine accepted this request.")
    return true
  }

  createChatTask(id: string, prompt: string): void {
    const timestamp = now()
    this.sql`INSERT INTO tasks (
      id, source, status, prompt, created_at, updated_at
    ) VALUES (${id}, 'chat', 'queued', ${prompt}, ${timestamp}, ${timestamp})`
    this.addActivity(id, "queued", "Task queued", "The Bot is preparing the work.")
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
      replyMessageId ? "Research sent" : "Research completed",
      replyMessageId ? "HQBase accepted the reply." : "The result is ready in this conversation.",
    )
  }

  failTask(taskId: string, error: string): void {
    const message = error.slice(0, 500)
    this.sql`UPDATE tasks SET status = 'failed', error = ${message}, updated_at = ${now()}
      WHERE id = ${taskId}`
    this.addActivity(taskId, "failed", "Task stopped", message)
  }

  getTask(taskId: string): BotTask | null {
    const rows = this.sql<Row>`SELECT * FROM tasks WHERE id = ${taskId}`
    return rows[0] ? taskFromRow(rows[0]) : null
  }

  getSnapshot(): BotSnapshot {
    const tasks = this.sql<Row>`SELECT * FROM tasks ORDER BY created_at DESC LIMIT 20`.map(
      taskFromRow,
    )
    const activeTask =
      tasks.find((task) => !["completed", "failed"].includes(task.status)) ?? tasks[0] ?? null
    const activity = activeTask
      ? this
          .sql<Row>`SELECT * FROM activity WHERE task_id = ${activeTask.id} ORDER BY created_at ASC`.map(
          activityFromRow,
        )
      : []
    return {
      profile: {
        id: this.env.HQBOT_ID,
        name: "HQBot",
        title: "Research and inbox teammate",
        description:
          "Reads requests from its HQBase mailbox, researches the public web with its cloud browser, and sends evidence-backed replies.",
      },
      routine: {
        name: "HQBase inbox",
        schedule: "Every minute",
        mailboxAddress: this.env.HQBASE_MAILBOX_ADDRESS ?? null,
        allowedSenders: (this.env.HQBOT_ALLOWED_SENDERS ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        autoReply: this.env.HQBOT_AUTO_REPLY === "true",
      },
      tasks,
      activeTask,
      activity,
    }
  }
}
