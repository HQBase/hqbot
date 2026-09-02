export interface SchemaMigration {
  version: number;
  statements: string[];
}

export const schemaMigrations: readonly SchemaMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tasks (
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
      )`,
      `CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS activity_task_created ON activity(task_id, created_at)"
    ]
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        brief TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider = 'legacy'),
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
      )`,
      "ALTER TABLE tasks ADD COLUMN bot_id TEXT",
      "ALTER TABLE tasks ADD COLUMN connection_id TEXT",
      "CREATE INDEX IF NOT EXISTS tasks_bot_created ON tasks(bot_id, created_at)"
    ]
  },
  {
    version: 3,
    statements: [
      "ALTER TABLE bots ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE bots ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
      `CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS memories_bot_created ON memories(bot_id, created_at)",
      `CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        next_run_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS routines_due ON routines(active, next_run_at)",
      `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        task_id TEXT,
        object_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
      )`,
      "CREATE INDEX IF NOT EXISTS files_bot_created ON files(bot_id, created_at)"
    ]
  },
  {
    version: 4,
    statements: [
      `CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        instructions TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(bot_id, name),
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS skills_bot_created ON skills(bot_id, created_at)",
      `CREATE TABLE IF NOT EXISTS computer_state (
        id TEXT PRIMARY KEY CHECK (id = 'shared'),
        session_id TEXT,
        url TEXT,
        screenshot_key TEXT,
        expires_at TEXT,
        cookies_ciphertext TEXT,
        cookies_iv TEXT,
        updated_at TEXT NOT NULL
      )`
    ]
  },
  {
    version: 5,
    statements: [
      "ALTER TABLE bots ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'",
      "ALTER TABLE bots ADD COLUMN last_interacted_at TEXT",
      "ALTER TABLE bots ADD COLUMN last_message TEXT",
      "ALTER TABLE bots ADD COLUMN model_id TEXT",
      "ALTER TABLE bots ADD COLUMN daily_budget_usd REAL NOT NULL DEFAULT 2",
      "ALTER TABLE connections ADD COLUMN change_cursor TEXT",
      "ALTER TABLE connections ADD COLUMN socket_status TEXT NOT NULL DEFAULT 'disconnected'",
      "ALTER TABLE connections ADD COLUMN last_event_at TEXT",
      "ALTER TABLE tasks ADD COLUMN submission_id TEXT",
      `CREATE TABLE IF NOT EXISTS owner (
        id TEXT PRIMARY KEY CHECK (id = 'owner'),
        username TEXT NOT NULL,
        salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        iterations INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS owner_sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS owner_sessions_expiry ON owner_sessions(expires_at)",
      `CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        bot_id TEXT,
        task_id TEXT,
        service TEXT NOT NULL,
        input_units INTEGER NOT NULL DEFAULT 0,
        output_units INTEGER NOT NULL DEFAULT 0,
        estimated_usd REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE SET NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
      )`,
      "CREATE INDEX IF NOT EXISTS usage_day ON usage_events(created_at, bot_id, task_id)"
    ]
  },
  {
    version: 6,
    statements: [
      `CREATE TABLE IF NOT EXISTS login_limits (
        key_hash TEXT PRIMARY KEY,
        failures INTEGER NOT NULL,
        window_started_at TEXT NOT NULL,
        blocked_until TEXT,
        updated_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS login_limits_updated ON login_limits(updated_at)"
    ]
  },
  {
    version: 7,
    statements: [
      `UPDATE usage_events SET bot_id = NULL, task_id = NULL
        WHERE task_id IN (SELECT id FROM tasks WHERE source = 'email')`,
      `UPDATE files SET task_id = NULL
        WHERE task_id IN (SELECT id FROM tasks WHERE source = 'email')`,
      `DELETE FROM activity
        WHERE task_id IN (SELECT id FROM tasks WHERE source = 'email')`,
      "DELETE FROM tasks WHERE source = 'email'",
      "DROP TABLE IF EXISTS connections"
    ]
  },
  {
    version: 8,
    statements: [
      `UPDATE tasks SET status = 'cancelled', error = NULL, updated_at = datetime('now')
        WHERE status NOT IN ('cancelled', 'completed', 'failed')`
    ]
  },
  {
    version: 9,
    statements: [
      "ALTER TABLE bots ADD COLUMN max_steps INTEGER CHECK (max_steps IS NULL OR max_steps >= 1)"
    ]
  },
  {
    version: 10,
    statements: [
      "ALTER TABLE tasks ADD COLUMN work_state TEXT",
      "ALTER TABLE tasks ADD COLUMN wake_at TEXT"
    ]
  }
];

export function pendingMigrations(appliedVersions: readonly number[]): readonly SchemaMigration[] {
  const applied = new Set(appliedVersions);
  return schemaMigrations.filter((migration) => !applied.has(migration.version));
}
