import type {
  BotActivity,
  BotTask,
  CostServiceTotals,
  CostSnapshot,
  CostTotal,
  TaskStatus,
  UsageInput
} from "../domain/types";
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
    browser: costTotal(),
    workersAi: costTotal()
  };
  for (const row of rows) {
    if (row.service === "browser") totals.browser = costTotal(row);
    if (row.service === "workers-ai") totals.workersAi = costTotal(row);
  }
  return totals;
}

const emptyPlatform: CostSnapshot["platform"] = {
  durableObjectGbSecondsPerDay: 0,
  hqbaseRealtimeConnections: 0,
  selectedBotHqbaseRealtime: false
};

export class WorkspaceTasks {
  constructor(private readonly sql: Sql) {}

  createEmailTask(input: {
    id: string;
    botId: string;
    connectionId: string;
    messageId: string;
    sender: string;
    subject: string;
    prompt: string;
  }): boolean {
    const timestamp = now();
    const rows = this.sql<{ id: string }>`INSERT OR IGNORE INTO tasks (
      id, bot_id, connection_id, source, status, prompt, subject, sender, source_message_id,
      created_at, updated_at
    ) VALUES (
      ${input.id}, ${input.botId}, ${input.connectionId}, 'email', 'queued', ${input.prompt},
      ${input.subject}, ${input.sender}, ${input.messageId}, ${timestamp}, ${timestamp}
    ) RETURNING id`;
    if (rows.length === 0) return false;
    this.addActivity(
      input.id,
      "queued",
      "Email received",
      "The connected HQBase inbox sent this task."
    );
    return true;
  }

  createChatTask(id: string, botId: string, prompt: string): void {
    const timestamp = now();
    this.sql`INSERT INTO tasks (
      id, bot_id, source, status, prompt, created_at, updated_at
    ) VALUES (${id}, ${botId}, 'chat', 'queued', ${prompt}, ${timestamp}, ${timestamp})`;
    this.addActivity(id, "queued", "Task queued", "Your teammate is preparing the work.");
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

  setTaskInput(
    taskId: string,
    prompt: string,
    subject: string | null,
    sender: string | null
  ): void {
    this.sql`UPDATE tasks SET prompt = ${prompt}, subject = ${subject}, sender = ${sender},
      updated_at = ${now()} WHERE id = ${taskId}`;
  }

  setStatus(taskId: string, status: TaskStatus): void {
    this.sql`UPDATE tasks SET status = ${status}, updated_at = ${now()} WHERE id = ${taskId}`;
  }

  getTask(taskId: string): BotTask | null {
    const row = this.sql<Row>`SELECT * FROM tasks WHERE id = ${taskId}`[0];
    return row ? taskFromRow(row) : null;
  }

  listTasks(botId: string): BotTask[] {
    return this.sql<Row>`SELECT * FROM tasks WHERE bot_id = ${botId}
      ORDER BY created_at DESC LIMIT 30`.map(taskFromRow);
  }

  listActivity(taskId: string): BotActivity[] {
    return this.sql<Row>`SELECT * FROM activity WHERE task_id = ${taskId}
      ORDER BY created_at ASC`.map(activityFromRow);
  }

  requestReplyApproval(taskId: string, result: string): boolean {
    const rows = this.sql<{ id: string }>`UPDATE tasks
      SET status = 'awaiting_approval', result = ${result}, updated_at = ${now()}
      WHERE id = ${taskId} AND source = 'email'
        AND status IN ('queued', 'working', 'researching', 'awaiting_approval')
      RETURNING id`;
    if (rows.length === 0) return false;
    this.addActivity(
      taskId,
      "approval",
      "Reply needs approval",
      "Review the draft before HQBot sends it through HQBase."
    );
    return true;
  }

  recordReplyDecision(taskId: string, approved: boolean): void {
    this.addActivity(
      taskId,
      approved ? "approved" : "denied",
      approved ? "Reply approved" : "Reply kept as a draft",
      approved ? "The approved reply can now be sent." : "Nothing was sent."
    );
  }

  rejectReply(taskId: string): boolean {
    const rows = this.sql<{ id: string }>`UPDATE tasks
      SET status = 'cancelled', error = NULL, updated_at = ${now()}
      WHERE id = ${taskId} AND source = 'email' AND status = 'awaiting_approval'
      RETURNING id`;
    return rows.length > 0;
  }

  addActivity(taskId: string, phase: string, title: string, detail: string | null = null): void {
    const id = `${taskId}:${phase}`;
    this.sql`INSERT OR IGNORE INTO activity (id, task_id, phase, title, detail, created_at)
      VALUES (${id}, ${taskId}, ${phase}, ${title}, ${detail}, ${now()})`;
  }

  recordBrowser(taskId: string, screenshotKey: string | null, browserUrl: string | null): void {
    this.sql`UPDATE tasks SET screenshot_key = ${screenshotKey}, browser_url = ${browserUrl},
      updated_at = ${now()} WHERE id = ${taskId}`;
  }

  completeTask(taskId: string, result: string, replyMessageId: string | null): void {
    this.sql`UPDATE tasks SET status = 'completed', result = ${result},
      reply_message_id = ${replyMessageId}, error = NULL, updated_at = ${now()} WHERE id = ${taskId}`;
    this.addActivity(
      taskId,
      "completed",
      replyMessageId ? "Work sent" : "Work completed",
      replyMessageId ? "HQBase accepted the reply." : "The result is ready in this chat."
    );
  }

  failTask(taskId: string, error: string): void {
    const message = error.slice(0, 500);
    this.sql`UPDATE tasks SET status = 'failed', error = ${message}, updated_at = ${now()}
      WHERE id = ${taskId}`;
    this.addActivity(taskId, "failed", "Task stopped", message);
  }

  cancelTask(taskId: string): void {
    this.sql`UPDATE tasks SET status = 'cancelled', error = NULL, updated_at = ${now()}
      WHERE id = ${taskId}`;
    this.addActivity(taskId, "cancelled", "Task stopped", "The owner stopped this work.");
  }

  recordUsage(input: UsageInput): void {
    this.sql`INSERT OR IGNORE INTO usage_events (
      id, bot_id, task_id, service, input_units, output_units, estimated_usd, created_at
    ) VALUES (
      ${input.id}, ${input.botId ?? null}, ${input.taskId ?? null}, ${input.service},
      ${input.inputUnits ?? 0}, ${input.outputUnits ?? 0}, ${input.estimatedUsd}, ${now()}
    )`;
  }

  getCosts(
    botId?: string | null,
    taskId?: string | null,
    platform: CostSnapshot["platform"] = emptyPlatform
  ): CostSnapshot {
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
      platform
    };
  }
}
