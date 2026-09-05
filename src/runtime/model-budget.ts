import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import type { ModelTokenRates } from "../domain/models";
import type { HQBotModelId, ModelUsageDto, WorkspaceAgentRpc } from "./types";

type Params = Parameters<NonNullable<LanguageModelMiddleware["transformParams"]>>[0]["params"];
type ProviderUsage = Awaited<ReturnType<Exclude<LanguageModel, string>["doGenerate"]>>["usage"];

export function estimateRequestTokens(params: Params): number {
  // UTF-8 bytes provide a conservative text estimate. Do not count base64 image bytes as text.
  let imageCount = 0;
  const text = JSON.stringify({ prompt: params.prompt, tools: params.tools }, (key, value) => {
    if (key === "data" && (typeof value === "string" || ArrayBuffer.isView(value))) {
      imageCount++;
      return "";
    }
    return value;
  });
  return new TextEncoder().encode(text).byteLength + imageCount * 8_192;
}

export function budgetedModel(input: {
  model: Exclude<LanguageModel, string>;
  modelId: HQBotModelId;
  botId: string;
  taskId: () => string | null;
  teamWorkId?: () => Promise<string | undefined>;
  workspace: WorkspaceAgentRpc;
  rates: () => Promise<ModelTokenRates | null>;
}): Exclude<LanguageModel, string> {
  async function reserve(params: Params) {
    const rates = await input.rates();
    const inputTokens = estimateRequestTokens(params);
    const outputTokens = Math.min(params.maxOutputTokens ?? 5_000, 5_000);
    const reservation = {
      eventId: crypto.randomUUID(),
      botId: input.botId,
      taskId: input.taskId(),
      teamWorkId: await input.teamWorkId?.(),
      inputTokens,
      outputTokens,
      unpriced: !rates,
      estimatedCostMicroUsd: rates
        ? Math.ceil(
            inputTokens * rates.inputUsdPerMillion + outputTokens * rates.outputUsdPerMillion
          )
        : 0
    };
    await input.workspace.reserveModelRequest(reservation);
    return { reservation, rates };
  }
  async function settle(saved: Awaited<ReturnType<typeof reserve>>, usage: ProviderUsage) {
    const inputUsage =
      typeof usage.inputTokens === "number"
        ? { total: usage.inputTokens, cacheRead: 0 }
        : usage.inputTokens;
    const outputUsage =
      typeof usage.outputTokens === "number"
        ? { total: usage.outputTokens, reasoning: 0 }
        : usage.outputTokens;
    const inputTokens = inputUsage?.total ?? saved.reservation.inputTokens;
    const outputTokens = outputUsage?.total ?? saved.reservation.outputTokens;
    const cachedInputTokens = Math.min(inputTokens, inputUsage?.cacheRead ?? 0);
    const rates = saved.rates;
    const event: ModelUsageDto = {
      ...saved.reservation,
      model: input.modelId,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      reasoningTokens: outputUsage?.reasoning ?? 0,
      estimatedCostMicroUsd: rates
        ? Math.ceil(
            (inputTokens - cachedInputTokens) * rates.inputUsdPerMillion +
              cachedInputTokens * rates.cachedInputUsdPerMillion +
              outputTokens * rates.outputUsdPerMillion
          )
        : 0,
      occurredAt: new Date().toISOString()
    };
    await input.workspace.recordUsage(event);
  }
  return wrapLanguageModel({
    model: input.model,
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        maxOutputTokens: Math.min(params.maxOutputTokens ?? 5_000, 5_000)
      }),
      wrapGenerate: async ({ doGenerate, params }) => {
        const saved = await reserve(params);
        const result = await doGenerate();
        await settle(saved, result.usage);
        return result;
      },
      wrapStream: async ({ doStream, params }) => {
        const saved = await reserve(params);
        const result = await doStream();
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              async transform(part, controller) {
                if (part.type === "finish") await settle(saved, part.usage);
                controller.enqueue(part);
              }
            })
          )
        };
      }
    }
  });
}
