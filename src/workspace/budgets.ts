import type { SpendPolicyDto } from "../runtime/types";
import type { WorkspaceCatalog } from "./catalog";
import type { WorkspaceTasks } from "./tasks";

export function positiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function checkSpendPolicy(
  env: Env,
  catalog: WorkspaceCatalog,
  tasks: WorkspaceTasks,
  botId: string,
  taskId: string | null
): SpendPolicyDto {
  const bot = catalog.getBot(botId);
  if (!bot) return { allowed: false, reason: "The teammate is not available" };
  const costs = tasks.getCosts(botId, taskId);
  if (costs.overall.estimatedUsd >= positiveNumber(env.HQBOT_GLOBAL_DAILY_BUDGET_USD, 5)) {
    return { allowed: false, reason: "The overall daily cost budget has been reached" };
  }
  if (costs.selectedBot.estimatedUsd >= bot.dailyBudgetUsd) {
    return { allowed: false, reason: "The teammate daily cost budget has been reached" };
  }
  if (taskId && costs.selectedTask.estimatedUsd >= positiveNumber(env.HQBOT_TASK_BUDGET_USD, 1)) {
    return { allowed: false, reason: "The task cost budget has been reached" };
  }
  const dailyTaskLimit = Math.max(1, Math.floor(positiveNumber(env.HQBOT_DAILY_TASK_LIMIT, 50)));
  if (taskId && tasks.countTasksSince(costs.dayStartedAt) > dailyTaskLimit) {
    return { allowed: false, reason: "The daily task limit has been reached" };
  }
  return { allowed: true, reason: null };
}
