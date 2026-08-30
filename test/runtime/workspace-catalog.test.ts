import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { schemaMigrations } from "../../src/domain/schema";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { readWorkspaceSnapshot } from "../../src/workspace/snapshot";
import type { Sql, SqlValue } from "../../src/workspace/sql";
import { WorkspaceTasks } from "../../src/workspace/tasks";

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

describe("workspace teammate lifecycle", () => {
  let database: DatabaseSync;
  let catalog: WorkspaceCatalog;
  let sql: Sql;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    for (const migration of schemaMigrations) {
      for (const statement of migration.statements) database.exec(statement);
    }
    sql = sqlFor(database);
    catalog = new WorkspaceCatalog(sql);
  });

  afterEach(() => database.close());

  it("archives a teammate without leaving mail or routines active", () => {
    catalog.createBot(
      "bot-1",
      { name: "Research", title: "Researcher", description: "Finds evidence." },
      "Research requests",
      "@cf/zai-org/glm-5.3-flash",
      2
    );
    catalog.automations.createRoutine({
      botId: "bot-1",
      id: "routine-1",
      intervalMinutes: 60,
      name: "Daily brief",
      nextRunAt: "2026-08-31T12:00:00.000Z",
      prompt: "Prepare the brief"
    });
    catalog.connectHQBase({
      botId: "bot-1",
      id: "connection-1",
      mailboxAddress: "hqbot@example.com",
      mailboxId: "mailbox-1",
      mailboxName: "HQBot",
      origin: "https://hqbase.example.com",
      tokenCiphertext: "ciphertext",
      tokenIv: "iv"
    });

    expect(catalog.archiveBot("bot-1")).toMatchObject({ hidden: true, connection: null });
    expect(catalog.listBots()).toEqual([]);
    expect(catalog.listArchivedBots()).toEqual([
      expect.objectContaining({ id: "bot-1", hidden: true })
    ]);
    expect(catalog.automations.listRoutines("bot-1")).toEqual([
      expect.objectContaining({ id: "routine-1", active: false })
    ]);
    expect(catalog.listActiveConnections()).toEqual([]);
  });

  it("lets an archived teammate remain selected for restore", () => {
    catalog.createBot(
      "bot-1",
      { name: "Research", title: "Researcher", description: "Finds evidence." },
      "Research requests",
      "@cf/zai-org/glm-5.3-flash",
      2
    );
    catalog.archiveBot("bot-1");

    const snapshot = readWorkspaceSnapshot(catalog, new WorkspaceTasks(sql), "bot-1");

    expect(snapshot.bots).toEqual([]);
    expect(snapshot.archivedBots).toEqual([expect.objectContaining({ id: "bot-1" })]);
    expect(snapshot.selectedBot).toMatchObject({ id: "bot-1", hidden: true });
  });

  it("deletes teammate data and keeps overall usage anonymous", () => {
    catalog.createBot(
      "bot-1",
      { name: "Research", title: "Researcher", description: "Finds evidence." },
      "Research requests",
      "@cf/zai-org/glm-5.3-flash",
      2
    );
    const tasks = new WorkspaceTasks(sql);
    tasks.createChatTask("task-1", "bot-1", "Research this");
    tasks.recordUsage({
      botId: "bot-1",
      estimatedUsd: 0.01,
      id: "usage-1",
      service: "workers-ai",
      taskId: "task-1"
    });
    catalog.createMemory("memory-1", "bot-1", "Remember this");
    catalog.createFile({
      botId: "bot-1",
      contentType: "text/plain",
      id: "file-1",
      key: "files/bot-1/file-1/note.txt",
      name: "note.txt",
      size: 4
    });
    catalog.createSkill({
      botId: "bot-1",
      description: "Find facts",
      id: "skill-1",
      instructions: "Use primary sources",
      name: "Research"
    });
    catalog.automations.createRoutine({
      botId: "bot-1",
      id: "routine-1",
      intervalMinutes: 60,
      name: "Daily brief",
      nextRunAt: "2026-08-31T12:00:00.000Z",
      prompt: "Prepare the brief"
    });
    catalog.connectHQBase({
      botId: "bot-1",
      id: "connection-1",
      mailboxAddress: "hqbot@example.com",
      mailboxId: "mailbox-1",
      mailboxName: "HQBot",
      origin: "https://hqbase.example.com",
      tokenCiphertext: "ciphertext",
      tokenIv: "iv"
    });

    expect(catalog.listBotArtifactKeys("bot-1")).toEqual(["files/bot-1/file-1/note.txt"]);
    expect(catalog.deleteBot("bot-1")).toBe(true);
    expect(catalog.deleteBot("bot-1")).toBe(false);
    for (const table of [
      "activity",
      "bots",
      "connections",
      "files",
      "memories",
      "routines",
      "skills",
      "tasks"
    ]) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
        count: 0
      });
    }
    expect(database.prepare("SELECT bot_id, task_id FROM usage_events").get()).toEqual({
      bot_id: null,
      task_id: null
    });
  });
});
