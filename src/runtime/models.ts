import type { LanguageModel, LanguageModelMiddleware } from "ai";
import { wrapLanguageModel } from "ai";

import { DEEPSEEK_FALLBACK_MODEL_ID, GLM_PRIMARY_MODEL_ID, type HQBotModelId } from "./types";

type ConcreteLanguageModel = Exclude<LanguageModel, string>;

export function concreteLanguageModel(model: LanguageModel): ConcreteLanguageModel {
  if (typeof model === "string") throw new Error("The model provider did not resolve the model ID");
  return model;
}

function canFallback(error: unknown): boolean {
  return !(error instanceof DOMException && error.name === "AbortError");
}

export function createHQBotModel(input: {
  resolve(modelId: HQBotModelId): ConcreteLanguageModel;
  onAttempt(modelId: HQBotModelId): void;
}): LanguageModel {
  const primary = input.resolve(GLM_PRIMARY_MODEL_ID);
  const fallback = wrapLanguageModel({
    model: input.resolve(DEEPSEEK_FALLBACK_MODEL_ID),
    middleware: {}
  });

  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      input.onAttempt(GLM_PRIMARY_MODEL_ID);
      try {
        return await doGenerate();
      } catch (error) {
        if (!canFallback(error)) throw error;
        input.onAttempt(DEEPSEEK_FALLBACK_MODEL_ID);
        return fallback.doGenerate(params);
      }
    },
    wrapStream: async ({ doStream, params }) => {
      input.onAttempt(GLM_PRIMARY_MODEL_ID);
      try {
        return await doStream();
      } catch (error) {
        if (!canFallback(error)) throw error;
        input.onAttempt(DEEPSEEK_FALLBACK_MODEL_ID);
        return fallback.doStream(params);
      }
    }
  };

  return wrapLanguageModel({
    model: primary,
    middleware,
    modelId: GLM_PRIMARY_MODEL_ID,
    providerId: "cloudflare-workers-ai"
  });
}
