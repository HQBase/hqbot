import type { ModelReservationDto } from "../runtime/types";
import { checkSpendPolicy, positiveNumber } from "./budgets";
import type { WorkspaceCatalog } from "./catalog";
import { now, type Sql } from "./sql";
import type { WorkspaceTasks } from "./tasks";
import { TeamWorkStore } from "./team-work-store";

// The caller runs this synchronous check and insert in one storage transaction.
export function reserveModelRequest(
  sql: Sql,
  env: Env,
  catalog: WorkspaceCatalog,
  tasks: WorkspaceTasks,
  input: ModelReservationDto
): void {
  if (sql`SELECT id FROM usage_events WHERE id = ${input.eventId}`.length) return;
  const policy = checkSpendPolicy(env, catalog, tasks, input.botId, input.taskId);
  if (!policy.allowed) throw new Error(policy.reason ?? "Model budget reached");
  const costs = tasks.getCosts(input.botId, input.taskId);
  const bot = catalog.getBot(input.botId);
  const amount = input.estimatedCostMicroUsd / 1_000_000;
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isInteger(input.inputTokens) ||
    input.inputTokens < 0 ||
    !Number.isInteger(input.outputTokens) ||
    input.outputTokens < 0
  )
    throw new Error("Invalid model reservation");
  if (
    costs.overall.estimatedUsd + amount > positiveNumber(env.HQBOT_GLOBAL_DAILY_BUDGET_USD, 5) ||
    costs.selectedBot.estimatedUsd + amount > (bot?.dailyBudgetUsd ?? 0) ||
    (input.taskId &&
      costs.selectedTask.estimatedUsd + amount > positiveNumber(env.HQBOT_TASK_BUDGET_USD, 1))
  )
    throw new Error("The next model request would exceed the cost budget");
  if (input.teamWorkId) {
    if (input.unpriced)
      throw new Error("Team tasks need a model with known prices to enforce their shared budget");
    new TeamWorkStore(sql).assertAllowed(input.teamWorkId, input.botId, amount);
  }
  const totals = sql<{
    calls: number;
    tokens: number;
  }>`SELECT COUNT(*) AS calls, COALESCE(SUM(input_units + output_units), 0) AS tokens
    FROM usage_events WHERE service = 'workers-ai' AND created_at >= ${costs.dayStartedAt} AND bot_id = ${input.botId}`[0];
  const global = sql<{
    calls: number;
    tokens: number;
  }>`SELECT COUNT(*) AS calls, COALESCE(SUM(input_units + output_units), 0) AS tokens
    FROM usage_events WHERE service = 'workers-ai' AND created_at >= ${costs.dayStartedAt}`[0];
  const tokens = input.inputTokens + input.outputTokens;
  const maxCalls = input.unpriced ? 100 : 500;
  const maxTokens = input.unpriced ? 250_000 : 2_000_000;
  if (
    (totals?.calls ?? 0) >= maxCalls ||
    (totals?.tokens ?? 0) + tokens > maxTokens ||
    (global?.calls ?? 0) >= 2_000 ||
    (global?.tokens ?? 0) + tokens > 8_000_000
  )
    throw new Error("The daily model request or token limit has been reached");
  sql`INSERT INTO usage_events (id, bot_id, task_id, service, input_units, output_units, estimated_usd, created_at, pricing_status, settled, team_work_id)
    VALUES (${input.eventId}, ${input.botId}, ${input.taskId}, 'workers-ai', ${input.inputTokens}, ${input.outputTokens}, ${amount}, ${now()}, ${input.unpriced ? "unknown" : "known"}, 0, ${input.teamWorkId ?? null})`;
}
