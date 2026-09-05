import type { TaskNotification } from "../domain/types";
import { now, type Row, type Sql, text } from "./sql";
export class WorkspaceNotifications {
  constructor(private readonly sql: Sql) {}
  add(id: string, botId: string, taskId: string | null, kind: string, title: string): void {
    this
      .sql`INSERT OR IGNORE INTO notifications (id, bot_id, task_id, kind, title, created_at) VALUES (${id}, ${botId}, ${taskId}, ${kind}, ${title}, ${now()})`;
  }
  list(): TaskNotification[] {
    return this
      .sql<Row>`SELECT * FROM notifications ORDER BY read_at IS NOT NULL, created_at DESC LIMIT 50`.map(
      (row) => ({
        id: text(row, "id"),
        botId: text(row, "bot_id"),
        taskId: row.task_id === null ? null : text(row, "task_id"),
        kind: text(row, "kind"),
        title: text(row, "title"),
        createdAt: text(row, "created_at"),
        readAt: row.read_at === null ? null : text(row, "read_at")
      })
    );
  }
  read(id: string): void {
    this.sql`UPDATE notifications SET read_at = ${now()} WHERE id = ${id}`;
  }
}
