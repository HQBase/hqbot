import type { SchemaMigration } from "./schema";

export const productMigrations: readonly SchemaMigration[] = [
  {
    version: 13,
    statements: [
      `CREATE TABLE IF NOT EXISTS knowledge_metadata (
        item_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, kind TEXT NOT NULL,
        revision INTEGER NOT NULL, source TEXT NOT NULL, category TEXT NOT NULL,
        status TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS knowledge_versions (
        item_id TEXT NOT NULL, bot_id TEXT NOT NULL, revision INTEGER NOT NULL,
        snapshot TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (item_id, revision),
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS knowledge_commands (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, item_id TEXT NOT NULL, kind TEXT NOT NULL,
        created_at TEXT NOT NULL, FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE)`
    ]
  },
  {
    version: 14,
    statements: [
      `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS project_teammates (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, PRIMARY KEY(project_id, bot_id))`,
      `CREATE TABLE IF NOT EXISTS project_resources (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL, item_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, PRIMARY KEY(project_id, kind, item_id))`,
      `CREATE TABLE IF NOT EXISTS project_messages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, sender_bot_id TEXT, content TEXT NOT NULL, parent_id TEXT, created_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS project_message_order ON project_messages(project_id, created_at, id)`,
      `CREATE TABLE IF NOT EXISTS collaboration_deliveries (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, message_id TEXT NOT NULL REFERENCES project_messages(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, sender_bot_id TEXT, root_id TEXT NOT NULL, depth INTEGER NOT NULL, response INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS collaboration_pending ON collaboration_deliveries(state, created_at)`
    ]
  },
  {
    version: 15,
    statements: [
      `CREATE TABLE IF NOT EXISTS routine_settings (routine_id TEXT PRIMARY KEY REFERENCES routines(id) ON DELETE CASCADE, revision INTEGER NOT NULL, schedule_json TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS routine_runs (id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, source TEXT NOT NULL, state TEXT NOT NULL, prompt TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS routine_run_queue ON routine_runs(state, updated_at)`,
      `CREATE INDEX IF NOT EXISTS routine_run_history ON routine_runs(routine_id, created_at)`
    ]
  },
  {
    version: 16,
    statements: [
      `CREATE TABLE IF NOT EXISTS event_triggers (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, name TEXT NOT NULL, revision INTEGER NOT NULL, enabled INTEGER NOT NULL, filter_json TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS event_receipts (trigger_id TEXT NOT NULL REFERENCES event_triggers(id) ON DELETE CASCADE, event_id TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY(trigger_id, event_id))`
    ]
  },
  {
    version: 17,
    statements: [
      `CREATE TABLE IF NOT EXISTS push_settings (id INTEGER PRIMARY KEY CHECK(id = 1), public_key TEXT NOT NULL, private_key TEXT NOT NULL, subject TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS push_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, subscription_json TEXT NOT NULL, name TEXT NOT NULL, preferences_json TEXT NOT NULL, created_at TEXT NOT NULL, last_status TEXT)`,
      `CREATE TABLE IF NOT EXISTS push_deliveries (id TEXT PRIMARY KEY, notification_id TEXT REFERENCES notifications(id) ON DELETE CASCADE, device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS push_delivery_queue ON push_deliveries(state, next_at)`,
      `CREATE TRIGGER IF NOT EXISTS queue_notification_push AFTER INSERT ON notifications BEGIN INSERT OR IGNORE INTO push_deliveries (id, notification_id, device_id, state, next_at, created_at, updated_at) SELECT NEW.id || ':' || id, NEW.id, id, 'queued', NEW.created_at, NEW.created_at, NEW.created_at FROM push_devices; END`
    ]
  }
];
