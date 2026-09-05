import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { schemaMigrations } from "../../src/domain/schema";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import type { Sql, SqlValue } from "../../src/workspace/sql";
import { WorkspaceTasks } from "../../src/workspace/tasks";

it("saves task notifications once and preserves their read state", () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const migration of schemaMigrations)
      for (const statement of migration.statements) database.exec(statement);
    const sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
      database
        .prepare(parts.join("?"))
        .all(
          ...values.map((value) => (typeof value === "boolean" ? Number(value) : value))
        )) as Sql;
    new WorkspaceCatalog(sql).createBot(
      "bot",
      { name: "Test", title: "Test", description: "Test" },
      "Test",
      "@cf/zai-org/glm-5.3-flash",
      2
    );
    const tasks = new WorkspaceTasks(sql);
    tasks.startTask("task", "bot", "Private task prompt");
    tasks.syncTaskState("task", "needs_user", null);
    tasks.syncTaskState("task", "needs_user", null);
    tasks.completeTask("task", "Private result");
    tasks.completeTask("task", "Private result");
    const notices = tasks.listNotifications();
    expect(notices).toHaveLength(2);
    expect(JSON.stringify(notices)).not.toContain("Private");
    tasks.readNotification("task:completed");
    expect(
      tasks.listNotifications().find((item) => item.id === "task:completed")?.readAt
    ).toBeTruthy();
  } finally {
    database.close();
  }
});
