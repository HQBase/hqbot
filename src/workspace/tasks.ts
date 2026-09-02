import type {
  BotActivity,
  BotTask,
  CostServiceTotals,
  CostSnapshot,
  CostTotal,
  UsageInput
} from "../domain/types";
import { readCloudflareResourceFootprint } from "./platform-footprint";
import { activityFromRow, now, number, type Row, type Sql, taskFromRow } from "./sql";

function startOfUtcDay(): string {
  const date = new Date();
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  ).toISOString();
}

function costTotal(row?: Row): CostTotal {
  return {
    estimatedUsd: number(row ?? {}, "estimated_usd"),
    inputUnits: number(row ?? {}, "input_units"),
    outputUnits: number(row ?? {}, "output_units")
  };
}

function serviceTotals(rows: Row[]): CostServiceTotals {
  const totals: CostServiceTotals = {
    sandbox: costTotal(),
    workersAi: costTotal()
  };
  for (const row of rows) {
    if (row.service === "sandbox") totals.sandbox = costTotal(row);
    if (row.service === "workers-ai") totals.workersAi = costTotal(row);
  }
  return totals;
}

export class WorkspaceTasks {
  constructor(private readonly sql: Sql) {}

  startTask(id: string, botId: string, prompt: string): void {
    const timestamp = now();
    const inserted = this.sql<{ id: string }>`INSERT OR IGNORE INTO tasks (
      id, bot_id, source, status, prompt, created_at, updated_at
    ) VALUES (${id}, ${botId}, 'chat', 'working', ${prompt}, ${timestamp}, ${timestamp})
      RETURNING id`;
    this.sql`UPDATE tasks SET status = 'working', prompt = ${prompt}, updated_at = ${timestamp}
      WHERE id = ${id} AND status NOT IN ('cancelled', 'completed', 'failed')`;
    if (inserted.length > 0) {
      this.addActivity(id, "working", "Work started", "Your teammate saved its progress.");
    }
  }

  countTasksSince(timestamp: string): number {
    return (
      this.sql<{ count: number }>`SELECT COUNT(*) AS count FROM tasks
        WHERE created_at >= ${timestamp}`[0]?.count ?? 0
    );
  }

  setSubmission(taskId: string, submissionId: string): void {
    this.sql`UPDATE tasks SET submission_id = ${submissionId}, updated_at = ${now()}
      WHERE id = ${taskId}`;
  }

  syncTaskState(taskId: string, workState: string, wakeAt: string | null): void {
    this.sql`UPDATE tasks SET work_state = ${workState}, wake_at = ${wakeAt},
      updated_at = ${now()} WHERE id = ${taskId}`;
  }

  getTask(taskId: string): BotTask | null {
    const row = this.sql<Row>`SELECT * FROM tasks WHERE id = ${taskId}`[0];
    return row ? taskFromRow(row) : null;
  }

  listTasks(botId: string): BotTask[] {
    return this.sql<Row>`SELECT * FROM tasks WHERE bot_id = ${botId}
      ORDER BY created_at DESC LIMIT 30`.map(taskFromRow);
  }

  cancelBotTasks(botId: string): string[] {
    const ids = this.sql<{ id: string }>`SELECT id FROM tasks WHERE bot_id = ${botId}
      AND status NOT IN ('cancelled', 'completed', 'failed')`;
    return ids.filter(({ id }) => this.cancelTask(id)).map(({ id }) => id);
  }

  listActivity(taskId: string): BotActivity[] {
    return this.sql<Row>`SELECT * FROM activity WHERE task_id = ${taskId}
      ORDER BY created_at ASC`.map(activityFromRow);
  }

  addActivity(taskId: string, phase: string, title: string, detail: string | null = null): void {
    const id = `${taskId}:${phase}`;
    this.sql`INSERT OR IGNORE INTO activity (id, task_id, phase, title, detail, created_at)
      VALUES (${id}, ${taskId}, ${phase}, ${title}, ${detail}, ${now()})`;
  }

  completeTask(taskId: string, result: string): void {
    this.sql`UPDATE tasks SET status = 'completed', result = ${result},
      error = NULL, updated_at = ${now()} WHERE id = ${taskId}`;
    this.addActivity(taskId, "completed", "Work completed", "The result is ready in this chat.");
  }

  failTask(taskId: string, error: string): void {
    const message = error.slice(0, 500);
    this.sql`UPDATE tasks SET status = 'failed', error = ${message}, updated_at = ${now()}
      WHERE id = ${taskId}`;
    this.addActivity(taskId, "failed", "Task stopped", message);
  }

  cancelTask(taskId: string): boolean {
    const rows = this.sql<{ id: string }>`UPDATE tasks
      SET status = 'cancelled', error = NULL, updated_at = ${now()}
      WHERE id = ${taskId}
        AND status NOT IN ('cancelled', 'completed', 'failed')
      RETURNING id`;
    if (rows.length === 0) return false;
    this.addActivity(taskId, "cancelled", "Task stopped", "The owner stopped this work.");
    return true;
  }

  recordUsage(input: UsageInput): void {
    this.sql`INSERT OR IGNORE INTO usage_events (
      id, bot_id, task_id, service, input_units, output_units, estimated_usd, created_at
    ) VALUES (
      ${input.id}, ${input.botId ?? null}, ${input.taskId ?? null}, ${input.service},
      ${input.inputUnits ?? 0}, ${input.outputUnits ?? 0}, ${input.estimatedUsd}, ${now()}
    )`;
  }

  getCosts(botId?: string | null, taskId?: string | null): CostSnapshot {
    const dayStartedAt = startOfUtcDay();
    const overall = this.sql<Row>`SELECT
      COALESCE(SUM(estimated_usd), 0) AS estimated_usd,
      COALESCE(SUM(input_units), 0) AS input_units,
      COALESCE(SUM(output_units), 0) AS output_units
      FROM usage_events WHERE created_at >= ${dayStartedAt}`[0];
    const bot = botId
      ? this.sql<Row>`SELECT
          COALESCE(SUM(estimated_usd), 0) AS estimated_usd,
          COALESCE(SUM(input_units), 0) AS input_units,
          COALESCE(SUM(output_units), 0) AS output_units
          FROM usage_events WHERE created_at >= ${dayStartedAt} AND bot_id = ${botId}`[0]
      : undefined;
    const task = taskId
      ? this.sql<Row>`SELECT
          COALESCE(SUM(estimated_usd), 0) AS estimated_usd,
          COALESCE(SUM(input_units), 0) AS input_units,
          COALESCE(SUM(output_units), 0) AS output_units
          FROM usage_events WHERE task_id = ${taskId}`[0]
      : undefined;
    const overallServices = this.sql<Row>`SELECT service,
      COALESCE(SUM(estimated_usd), 0) AS estimated_usd,
      COALESCE(SUM(input_units), 0) AS input_units,
      COALESCE(SUM(output_units), 0) AS output_units
      FROM usage_events WHERE created_at >= ${dayStartedAt}
      GROUP BY service`;
    const botServices = botId
      ? this.sql<Row>`SELECT service,
          COALESCE(SUM(estimated_usd), 0) AS estimated_usd,
          COALESCE(SUM(input_units), 0) AS input_units,
          COALESCE(SUM(output_units), 0) AS output_units
          FROM usage_events WHERE created_at >= ${dayStartedAt} AND bot_id = ${botId}
          GROUP BY service`
      : [];
    const taskServices = taskId
      ? this.sql<Row>`SELECT service,
          COALESCE(SUM(estimated_usd), 0) AS estimated_usd,
          COALESCE(SUM(input_units), 0) AS input_units,
          COALESCE(SUM(output_units), 0) AS output_units
          FROM usage_events WHERE task_id = ${taskId}
          GROUP BY service`
      : [];
    return {
      overall: costTotal(overall),
      selectedBot: costTotal(bot),
      selectedTask: costTotal(task),
      dayStartedAt,
      services: {
        overall: serviceTotals(overallServices),
        selectedBot: serviceTotals(botServices),
        selectedTask: serviceTotals(taskServices)
      },
      platform: {
        resources: readCloudflareResourceFootprint(this.sql, botId, dayStartedAt)
      }
    };
  }
}
