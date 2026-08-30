import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { schemaMigrations } from "../../src/domain/schema";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

function bind(value: SqlValue): SQLInputValue {
  return typeof value === "boolean" ? Number(value) : value;
}

function sqlFor(database: DatabaseSync): Sql {
  return ((strings: TemplateStringsArray, ...values: SqlValue[]) => {
    let statement = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) {
      statement += `?${strings[index + 1] ?? ""}`;
    }
    return database.prepare(statement).all(...values.map(bind));
  }) as Sql;
}

function applyThrough(database: DatabaseSync, version: number): void {
  for (const migration of schemaMigrations.filter((candidate) => candidate.version <= version)) {
    for (const statement of migration.statements) database.exec(statement);
    database
      .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(migration.version, "2026-08-30T12:00:00.000Z");
  }
}

describe("workspace migrations", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => database?.close());

  it("builds a fresh workspace without the legacy connection table", () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);

    migrateWorkspace(sql);
    migrateWorkspace(sql);

    expect(
      database.prepare("SELECT version FROM schema_migrations ORDER BY version").all()
    ).toEqual(schemaMigrations.map(({ version }) => ({ version })));
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'connections'")
        .get()
    ).toBeUndefined();
  });

  it("removes legacy mail content and keeps usage totals anonymous", () => {
    database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyThrough(database, 6);
    database.exec(`
      INSERT INTO bots (id, name, title, description, brief, created_at, updated_at)
      VALUES ('bot-1', 'Research', 'Researcher', 'Finds evidence.', 'Research requests',
        '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z');
      INSERT INTO tasks (
        id, bot_id, connection_id, source, status, prompt, subject, sender, source_message_id,
        result, reply_message_id, created_at, updated_at
      ) VALUES (
        'email-task', 'bot-1', 'connection-1', 'email', 'completed', 'Private request',
        'Private subject', 'sender@example.com', 'message-1', 'Private result', 'reply-1',
        '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z'
      );
      INSERT INTO tasks (id, bot_id, source, status, prompt, created_at, updated_at)
      VALUES ('chat-task', 'bot-1', 'chat', 'completed', 'Keep this chat',
        '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z');
      INSERT INTO activity (id, task_id, phase, title, created_at) VALUES
        ('email-activity', 'email-task', 'completed', 'Private activity',
          '2026-08-30T12:00:00.000Z'),
        ('chat-activity', 'chat-task', 'completed', 'Chat complete',
          '2026-08-30T12:00:00.000Z');
      INSERT INTO files (id, bot_id, task_id, object_key, name, content_type, size, created_at)
      VALUES
        ('email-file', 'bot-1', 'email-task', 'files/email', 'email.txt', 'text/plain', 10,
          '2026-08-30T12:00:00.000Z'),
        ('chat-file', 'bot-1', 'chat-task', 'files/chat', 'chat.txt', 'text/plain', 20,
          '2026-08-30T12:00:00.000Z');
      INSERT INTO usage_events (
        id, bot_id, task_id, service, input_units, output_units, estimated_usd, created_at
      ) VALUES
        ('email-usage', 'bot-1', 'email-task', 'workers-ai', 10, 2, 0.01,
          '2026-08-30T12:00:00.000Z'),
        ('chat-usage', 'bot-1', 'chat-task', 'workers-ai', 20, 4, 0.02,
          '2026-08-30T12:00:00.000Z');
      INSERT INTO connections (
        id, bot_id, provider, origin, mailbox_id, mailbox_address, mailbox_name,
        token_ciphertext, token_iv, created_at
      ) VALUES (
        'connection-1', 'bot-1', 'legacy', 'https://example.com', 'mailbox-1',
        'bot@example.com', 'Mailbox', 'ciphertext', 'iv', '2026-08-30T12:00:00.000Z'
      );
    `);

    const sql = sqlFor(database);
    migrateWorkspace(sql);
    migrateWorkspace(sql);

    expect(database.prepare("SELECT id, source, prompt FROM tasks ORDER BY id").all()).toEqual([
      { id: "chat-task", source: "chat", prompt: "Keep this chat" }
    ]);
    expect(database.prepare("SELECT id FROM activity ORDER BY id").all()).toEqual([
      { id: "chat-activity" }
    ]);
    expect(
      database.prepare("SELECT id, bot_id, task_id FROM usage_events ORDER BY id").all()
    ).toEqual([
      { id: "chat-usage", bot_id: "bot-1", task_id: "chat-task" },
      { id: "email-usage", bot_id: null, task_id: null }
    ]);
    expect(database.prepare("SELECT SUM(estimated_usd) AS total FROM usage_events").get()).toEqual({
      total: 0.03
    });
    expect(database.prepare("SELECT id, task_id FROM files ORDER BY id").all()).toEqual([
      { id: "chat-file", task_id: "chat-task" },
      { id: "email-file", task_id: null }
    ]);
    expect(database.prepare("SELECT id FROM bots").all()).toEqual([{ id: "bot-1" }]);
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'connections'")
        .get()
    ).toBeUndefined();
    expect(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual(
      {
        version: 7
      }
    );
  });
});
