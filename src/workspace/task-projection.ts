import type { TaskProjectionDto } from "../runtime/types";
import { isTerminalWork } from "../runtime/work";
import { WorkspaceNotifications } from "./notifications";
import type { Row, Sql } from "./sql";

// Run in the workspace storage transaction: observers see one complete state change.
export function projectTask(sql: Sql, { botId, work }: TaskProjectionDto): boolean {
  const task = sql<Row>`SELECT * FROM tasks WHERE id = ${work.taskId}`[0];
  if (task && task.bot_id !== botId) throw new Error("The task belongs to another teammate");
  if (!sql`SELECT id FROM bots WHERE id = ${botId}`.length) return false;
  const previous = sql<Row>`SELECT * FROM task_projections WHERE task_id = ${work.taskId}`[0];
  if (
    previous &&
    (Number(previous.generation) > work.generation ||
      (Number(previous.generation) === work.generation &&
        (String(previous.updated_at) > work.updatedAt ||
          (previous.updated_at === work.updatedAt && previous.state === work.state))))
  )
    return false;
  if (
    task &&
    ["completed", "failed", "cancelled"].includes(String(task.status)) &&
    !isTerminalWork(work.state)
  )
    return false;

  const status =
    work.state === "done" ? "completed" : isTerminalWork(work.state) ? work.state : "working";
  const error =
    work.lastError ?? (work.state === "cancelled" ? "Cancellation reason was not recorded." : null);
  sql`INSERT INTO tasks (id, bot_id, source, status, prompt, work_state, wake_at,
    submission_id, result, error, created_at, updated_at)
    VALUES (${work.taskId}, ${botId}, 'chat', ${status}, ${work.goal}, ${work.state},
      ${work.wakeAt}, ${work.submissionId}, ${work.state === "done" ? work.checkpoint : null},
      ${error}, ${work.createdAt}, ${work.updatedAt})
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, prompt = excluded.prompt,
      work_state = excluded.work_state, wake_at = excluded.wake_at,
      submission_id = excluded.submission_id, result = excluded.result, error = excluded.error,
      updated_at = excluded.updated_at`;
  sql`INSERT INTO task_projections (task_id, generation, updated_at, state)
    VALUES (${work.taskId}, ${work.generation}, ${work.updatedAt}, ${work.state})
    ON CONFLICT(task_id) DO UPDATE SET generation = excluded.generation,
      updated_at = excluded.updated_at, state = excluded.state`;

  const terminal = isTerminalWork(work.state);
  const title =
    work.state === "done"
      ? "Work completed"
      : work.state === "failed"
        ? "Task failed"
        : work.state === "cancelled"
          ? "Task stopped"
          : "Work started";
  if (!task || terminal) {
    const phase = terminal ? status : "working";
    sql`INSERT OR IGNORE INTO activity (id, task_id, phase, title, detail, created_at)
      VALUES (${`${work.taskId}:${phase}`}, ${work.taskId}, ${phase}, ${title},
        ${terminal ? error : "Your teammate saved its progress."}, ${work.updatedAt})`;
  }
  if (task?.work_state !== work.state) {
    const input = ["needs_user", "uncertain"].includes(work.state);
    if (terminal || input)
      new WorkspaceNotifications(sql).add(
        terminal ? `${work.taskId}:${status}` : `${work.taskId}:${work.generation}:input`,
        botId,
        work.taskId,
        input ? "input" : status,
        input ? "Task needs your input" : title
      );
  }
  const botStatus = work.state === "running" ? "working" : "idle";
  const summary = work.state === "done" ? work.checkpoint : terminal ? title : work.goal;
  // A recovered old task must not replace a newer chat turn or move it up the list.
  sql`UPDATE bots SET status = ${botStatus}, last_message = ${summary.slice(0, 240)},
    last_interacted_at = ${work.updatedAt}, updated_at = MAX(updated_at, ${work.updatedAt})
    WHERE id = ${botId} AND (last_interacted_at IS NULL OR last_interacted_at <= ${work.updatedAt})`;
  return true;
}
