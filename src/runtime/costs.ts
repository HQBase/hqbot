import type { LanguageModelUsage } from "ai";

import {
  DEEPSEEK_FALLBACK_MODEL_ID,
  GLM_PRIMARY_MODEL_ID,
  type HQBotModelId,
  type ModelUsageDto
} from "./types";

interface TokenRates {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

const MODEL_RATES: Record<HQBotModelId, TokenRates> = {
  [GLM_PRIMARY_MODEL_ID]: {
    inputUsdPerMillion: 0.15,
    cachedInputUsdPerMillion: 0.03,
    outputUsdPerMillion: 0.5
  },
  [DEEPSEEK_FALLBACK_MODEL_ID]: {
    inputUsdPerMillion: 0.44,
    cachedInputUsdPerMillion: 0.014,
    outputUsdPerMillion: 1.32
  }
};

function count(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return 0;
  return Math.max(0, Math.round(value));
}

export function identifyModel(modelId: string | undefined, attempted: HQBotModelId): HQBotModelId {
  if (modelId?.includes("deepseek-v4-flash")) return DEEPSEEK_FALLBACK_MODEL_ID;
  if (modelId?.includes("glm-5.3-flash")) return GLM_PRIMARY_MODEL_ID;
  return attempted;
}

export function estimateModelUsage(input: {
  botId: string;
  taskId: string | null;
  model: HQBotModelId;
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
  const rates = MODEL_RATES[input.model];

  // One dollar per million tokens is one micro-dollar per token.
  const estimatedCostMicroUsd = Math.round(
    uncachedInputTokens * rates.inputUsdPerMillion +
      cachedInputTokens * rates.cachedInputUsdPerMillion +
      outputTokens * rates.outputUsdPerMillion
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
