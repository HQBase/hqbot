import { now, type Sql } from "./sql";

function hasColumn(sql: Sql, table: string, column: string): boolean {
  if (table === "tasks") {
    return sql<{ name: string }>`PRAGMA table_info(tasks)`.some((row) => row.name === column);
  }
  if (table === "bots") {
    return sql<{ name: string }>`PRAGMA table_info(bots)`.some((row) => row.name === column);
  }
  return sql<{ name: string }>`PRAGMA table_info(connections)`.some((row) => row.name === column);
}

function isApplied(sql: Sql, version: number): boolean {
  return (
    sql<{ version: number }>`SELECT version FROM schema_migrations WHERE version = ${version}`
      .length > 0
  );
}

function finish(sql: Sql, version: number): void {
  sql`INSERT INTO schema_migrations (version, applied_at) VALUES (${version}, ${now()})`;
}

function migrateOne(sql: Sql): void {
  if (isApplied(sql, 1)) return;
  sql`CREATE TABLE IF NOT EXISTS tasks (
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
  )`;
  sql`CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )`;
  sql`CREATE INDEX IF NOT EXISTS activity_task_created ON activity(task_id, created_at)`;
  finish(sql, 1);
}

function migrateTwo(sql: Sql): void {
  if (isApplied(sql, 2)) return;
  sql`CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    brief TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  sql`CREATE TABLE IF NOT EXISTS connections (
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
  )`;
  if (!hasColumn(sql, "tasks", "bot_id")) sql`ALTER TABLE tasks ADD COLUMN bot_id TEXT`;
  if (!hasColumn(sql, "tasks", "connection_id")) {
    sql`ALTER TABLE tasks ADD COLUMN connection_id TEXT`;
  }
  sql`CREATE INDEX IF NOT EXISTS tasks_bot_created ON tasks(bot_id, created_at)`;
  const legacy = sql<{ count: number }>`SELECT COUNT(*) AS count FROM tasks WHERE bot_id IS NULL`;
  if ((legacy[0]?.count ?? 0) > 0) {
    const timestamp = now();
    sql`INSERT OR IGNORE INTO bots (
      id, name, title, description, brief, created_at, updated_at
    ) VALUES (
      'legacy', 'HQBot', 'Research teammate',
      'I research the public web and return evidence-backed work.',
      'Legacy HQBot teammate', ${timestamp}, ${timestamp}
    )`;
    sql`UPDATE tasks SET bot_id = 'legacy' WHERE bot_id IS NULL`;
  }
  finish(sql, 2);
}

function migrateThree(sql: Sql): void {
  if (isApplied(sql, 3)) return;
  if (!hasColumn(sql, "bots", "pinned")) {
    sql`ALTER TABLE bots ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`;
  }
  if (!hasColumn(sql, "bots", "hidden")) {
    sql`ALTER TABLE bots ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`;
  }
  sql`CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
  )`;
  sql`CREATE INDEX IF NOT EXISTS memories_bot_created ON memories(bot_id, created_at)`;
  sql`CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL,
    interval_minutes INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    next_run_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
  )`;
  sql`CREATE INDEX IF NOT EXISTS routines_due ON routines(active, next_run_at)`;
  sql`CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, task_id TEXT, object_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
  )`;
  sql`CREATE INDEX IF NOT EXISTS files_bot_created ON files(bot_id, created_at)`;
  finish(sql, 3);
}

function migrateFour(sql: Sql): void {
  if (isApplied(sql, 4)) return;
  sql`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
    instructions TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(bot_id, name), FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
  )`;
  sql`CREATE INDEX IF NOT EXISTS skills_bot_created ON skills(bot_id, created_at)`;
  sql`CREATE TABLE IF NOT EXISTS computer_state (
    id TEXT PRIMARY KEY CHECK (id = 'shared'), session_id TEXT, url TEXT, screenshot_key TEXT,
    expires_at TEXT, cookies_ciphertext TEXT, cookies_iv TEXT, updated_at TEXT NOT NULL
  )`;
  finish(sql, 4);
}

function migrateFive(sql: Sql): void {
  if (isApplied(sql, 5)) return;
  if (!hasColumn(sql, "bots", "status")) {
    sql`ALTER TABLE bots ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'`;
  }
  if (!hasColumn(sql, "bots", "last_interacted_at")) {
    sql`ALTER TABLE bots ADD COLUMN last_interacted_at TEXT`;
  }
  if (!hasColumn(sql, "bots", "last_message")) {
    sql`ALTER TABLE bots ADD COLUMN last_message TEXT`;
  }
  if (!hasColumn(sql, "bots", "model_id")) sql`ALTER TABLE bots ADD COLUMN model_id TEXT`;
  if (!hasColumn(sql, "bots", "daily_budget_usd")) {
    sql`ALTER TABLE bots ADD COLUMN daily_budget_usd REAL NOT NULL DEFAULT 2`;
  }
  if (!hasColumn(sql, "connections", "change_cursor")) {
    sql`ALTER TABLE connections ADD COLUMN change_cursor TEXT`;
  }
  if (!hasColumn(sql, "connections", "socket_status")) {
    sql`ALTER TABLE connections ADD COLUMN socket_status TEXT NOT NULL DEFAULT 'disconnected'`;
  }
  if (!hasColumn(sql, "connections", "last_event_at")) {
    sql`ALTER TABLE connections ADD COLUMN last_event_at TEXT`;
  }
  if (!hasColumn(sql, "tasks", "submission_id")) {
    sql`ALTER TABLE tasks ADD COLUMN submission_id TEXT`;
  }
  sql`CREATE TABLE IF NOT EXISTS owner (
    id TEXT PRIMARY KEY CHECK (id = 'owner'), username TEXT NOT NULL, salt TEXT NOT NULL,
    password_hash TEXT NOT NULL, iterations INTEGER NOT NULL, created_at TEXT NOT NULL
  )`;
  sql`CREATE TABLE IF NOT EXISTS owner_sessions (
    token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  )`;
  sql`CREATE INDEX IF NOT EXISTS owner_sessions_expiry ON owner_sessions(expires_at)`;
  sql`CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY, bot_id TEXT, task_id TEXT, service TEXT NOT NULL,
    input_units INTEGER NOT NULL DEFAULT 0, output_units INTEGER NOT NULL DEFAULT 0,
    estimated_usd REAL NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE SET NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
  )`;
  sql`CREATE INDEX IF NOT EXISTS usage_day ON usage_events(created_at, bot_id, task_id)`;
  finish(sql, 5);
}

function migrateSix(sql: Sql): void {
  if (isApplied(sql, 6)) return;
  sql`CREATE TABLE IF NOT EXISTS login_limits (
    key_hash TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_started_at TEXT NOT NULL,
    blocked_until TEXT, updated_at TEXT NOT NULL
  )`;
  sql`CREATE INDEX IF NOT EXISTS login_limits_updated ON login_limits(updated_at)`;
  finish(sql, 6);
}

export function migrateWorkspace(sql: Sql): void {
  sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`;
  migrateOne(sql);
  migrateTwo(sql);
  migrateThree(sql);
  migrateFour(sql);
  migrateFive(sql);
  migrateSix(sql);
}
