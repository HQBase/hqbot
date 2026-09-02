import type { LanguageModelUsage } from "ai";

import { HQBOT_MODELS, type HQBotModelId, type ModelTokenRates } from "../domain/models";
import { modelTokenRates } from "./model-catalog";
import type { ModelUsageDto } from "./types";

function count(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return 0;
  return Math.max(0, Math.round(value));
}

export function identifyModel(modelId: string | undefined, attempted: HQBotModelId): HQBotModelId {
  return modelId?.startsWith("@cf/") ? (modelId as HQBotModelId) : attempted;
}

export function estimateModelUsage(input: {
  botId: string;
  taskId: string | null;
  model: HQBotModelId;
  rates?: ModelTokenRates | null;
  usage: LanguageModelUsage;
  occurredAt?: string;
}): ModelUsageDto {
  const inputTokens = count(input.usage.inputTokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    count(input.usage.inputTokenDetails.cacheReadTokens)
  );
  const outputTokens = count(input.usage.outputTokens);
  const reasoningTokens = count(input.usage.outputTokenDetails.reasoningTokens);
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const rates =
    input.rates === undefined ? modelTokenRates(HQBOT_MODELS, input.model) : input.rates;

  // One dollar per million tokens is one micro-dollar per token.
  const estimatedCostMicroUsd = Math.round(
    rates
      ? uncachedInputTokens * rates.inputUsdPerMillion +
          cachedInputTokens * rates.cachedInputUsdPerMillion +
          outputTokens * rates.outputUsdPerMillion
      : 0
  );

  return {
    botId: input.botId,
    taskId: input.taskId,
    model: input.model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    estimatedCostMicroUsd,
    occurredAt: input.occurredAt ?? new Date().toISOString()
  };
}
