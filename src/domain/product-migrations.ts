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
  }
];
