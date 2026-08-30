import type {
  BotActivity,
  BotFile,
  BotMemory,
  BotRoutine,
  BotSkill,
  BotTask,
  BotTeammate,
  StoredComputerState,
  TaskSource,
  TaskStatus
} from "../domain/types";

export type SqlValue = string | number | boolean | null;
export type Row = Record<string, SqlValue>;
export type Sql = <T extends Record<string, SqlValue> = Row>(
  strings: TemplateStringsArray,
  ...values: SqlValue[]
) => T[];

export function now(): string {
  return new Date().toISOString();
}

export function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Invalid stored ${key}`);
  return value;
}

export function number(row: Row, key: string, fallback = 0): number {
  const value = row[key];
  return typeof value === "number" ? value : fallback;
}

export function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export function taskFromRow(row: Row): BotTask {
  return {
    id: text(row, "id"),
    botId: nullableText(row, "bot_id") ?? "legacy",
    source: text(row, "source") as TaskSource,
    status: text(row, "status") as TaskStatus,
    prompt: text(row, "prompt"),
    submissionId: nullableText(row, "submission_id"),
    result: nullableText(row, "result"),
    screenshotKey: nullableText(row, "screenshot_key"),
    browserUrl: nullableText(row, "browser_url"),
    error: nullableText(row, "error"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at")
  };
}

export function activityFromRow(row: Row): BotActivity {
  return {
    id: text(row, "id"),
    taskId: text(row, "task_id"),
    phase: text(row, "phase"),
    title: text(row, "title"),
    detail: nullableText(row, "detail"),
    createdAt: text(row, "created_at")
  };
}

export function botFromRow(row: Row): BotTeammate {
  const rawStatus = nullableText(row, "status");
  const status = ["idle", "working", "needs_approval", "offline"].includes(rawStatus ?? "")
    ? (rawStatus as BotTeammate["status"])
    : "idle";
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    title: text(row, "title"),
    description: text(row, "description"),
    brief: text(row, "brief"),
    pinned: row.pinned === 1,
    hidden: row.hidden === 1,
    status,
    lastInteractedAt: nullableText(row, "last_interacted_at"),
    lastMessage: nullableText(row, "last_message"),
    modelId: nullableText(row, "model_id"),
    dailyBudgetUsd: number(row, "daily_budget_usd", 2),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at")
  };
}

export function memoryFromRow(row: Row): BotMemory {
  return {
    id: text(row, "id"),
    botId: text(row, "bot_id"),
    content: text(row, "content"),
    createdAt: text(row, "created_at")
  };
}

export function routineFromRow(row: Row): BotRoutine {
  return {
    id: text(row, "id"),
    botId: text(row, "bot_id"),
    name: text(row, "name"),
    prompt: text(row, "prompt"),
    intervalMinutes: number(row, "interval_minutes"),
    active: row.active === 1,
    nextRunAt: text(row, "next_run_at"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at")
  };
}

export function fileFromRow(row: Row): BotFile {
  return {
    id: text(row, "id"),
    botId: text(row, "bot_id"),
    taskId: nullableText(row, "task_id"),
    key: text(row, "object_key"),
    name: text(row, "name"),
    contentType: text(row, "content_type"),
    size: number(row, "size"),
    createdAt: text(row, "created_at")
  };
}

export function skillFromRow(row: Row): BotSkill {
  return {
    id: text(row, "id"),
    botId: text(row, "bot_id"),
    name: text(row, "name"),
    description: text(row, "description"),
    instructions: text(row, "instructions"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at")
  };
}

export function computerFromRow(row?: Row): StoredComputerState {
  const expiresAt = row ? nullableText(row, "expires_at") : null;
  return {
    active: Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now()),
    sessionId: row ? nullableText(row, "session_id") : null,
    url: row ? nullableText(row, "url") : null,
    screenshotKey: row ? nullableText(row, "screenshot_key") : null,
    expiresAt,
    cookiesCiphertext: row ? nullableText(row, "cookies_ciphertext") : null,
    cookiesIv: row ? nullableText(row, "cookies_iv") : null,
    updatedAt: row ? text(row, "updated_at") : null
  };
}
