import type { LanguageModel, LanguageModelMiddleware } from "ai";
import { wrapLanguageModel } from "ai";

import { DEEPSEEK_FALLBACK_MODEL_ID, GLM_PRIMARY_MODEL_ID, type HQBotModelId } from "./types";

type ConcreteLanguageModel = Exclude<LanguageModel, string>;
type ModelCallParams = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"];

function exposeToolImages(params: ModelCallParams): ModelCallParams {
  const prompt: ModelCallParams["prompt"] = [];
  for (const message of params.prompt) {
    if (message.role !== "tool") {
      prompt.push(message);
      continue;
    }

    const images: Extract<
      Extract<ModelCallParams["prompt"][number], { role: "user" }>["content"][number],
      { type: "file" }
    >[] = [];
    const content = message.content.map((part) => {
      if (part.type !== "tool-result" || part.output.type !== "content") return part;
      return {
        ...part,
        output: {
          ...part.output,
          value: part.output.value.filter((item) => {
            if (item.type !== "file" || !item.mediaType.toLowerCase().startsWith("image/"))
              return true;
            images.push(item);
            return false;
          })
        }
      };
    });
    prompt.push({ ...message, content });
    if (images.length > 0) {
      prompt.push({
        role: "user",
        content: [{ type: "text", text: "Image output from the preceding tool." }, ...images]
      });
    }
  }
  return { ...params, prompt };
}

export function concreteLanguageModel(model: LanguageModel): ConcreteLanguageModel {
  if (typeof model === "string") throw new Error("The model provider did not resolve the model ID");
  return model;
}

function canFallback(error: unknown): boolean {
  return !(error instanceof DOMException && error.name === "AbortError");
}

export function createHQBotModel(input: {
  primaryModelId?: HQBotModelId;
  resolve(modelId: HQBotModelId): ConcreteLanguageModel;
  onAttempt(modelId: HQBotModelId): void;
}): LanguageModel {
  const primaryModelId = input.primaryModelId ?? GLM_PRIMARY_MODEL_ID;
  const fallbackModelId =
    primaryModelId === GLM_PRIMARY_MODEL_ID ? DEEPSEEK_FALLBACK_MODEL_ID : GLM_PRIMARY_MODEL_ID;
  const primary = input.resolve(primaryModelId);
  const fallback = wrapLanguageModel({
    model: input.resolve(fallbackModelId),
    middleware: {}
  });

  const middleware: LanguageModelMiddleware = {
    transformParams: async ({ params }) => exposeToolImages(params),
    wrapGenerate: async ({ doGenerate, params }) => {
      input.onAttempt(primaryModelId);
      try {
        return await doGenerate();
      } catch (error) {
        if (!canFallback(error)) throw error;
        input.onAttempt(fallbackModelId);
        return fallback.doGenerate(params);
      }
    },
    wrapStream: async ({ doStream, params }) => {
      input.onAttempt(primaryModelId);
      try {
        return await doStream();
      } catch (error) {
        if (!canFallback(error)) throw error;
        input.onAttempt(fallbackModelId);
        return fallback.doStream(params);
      }
    }
  };

  return wrapLanguageModel({
    model: primary,
    middleware,
    modelId: primaryModelId,
    providerId: "cloudflare-workers-ai"
  });
}
