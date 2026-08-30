export interface SchemaMigration {
  version: number
  statements: string[]
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
      "CREATE INDEX IF NOT EXISTS activity_task_created ON activity(task_id, created_at)",
    ],
  },
]

export function pendingMigrations(appliedVersions: readonly number[]): readonly SchemaMigration[] {
  const applied = new Set(appliedVersions)
  return schemaMigrations.filter((migration) => !applied.has(migration.version))
}
