import { describe, expect, it, vi } from "vitest";

import { HQBOT_MODELS } from "../../src/domain/models";
import { listHQBotModels, parseHQBotModels } from "../../src/runtime/model-catalog";

describe("Cloudflare AI model catalog", () => {
  it("keeps tool-capable Workers AI and AI Gateway models", () => {
    const models = parseHQBotModels([
      {
        name: "@cf/openai/gpt-oss-20b",
        description: "A tool model.",
        task: { name: "Text Generation" },
        properties: [
          { property_id: "function_calling", value: "true" },
          { property_id: "reasoning", value: "true" },
          { property_id: "context_window", value: "128000" },
          {
            property_id: "price",
            value: [
              { unit: "per M input tokens", price: 0.2, currency: "USD" },
              { unit: "per M output tokens", price: 0.3, currency: "USD" }
            ]
          }
        ]
      },
      {
        name: "@cf/meta/llama-guard-3-8b",
        task: { name: "Text Generation" },
        properties: []
      },
      {
        name: "@cf/baai/bge-base-en-v1.5",
        task: { name: "Text Embeddings" },
        properties: [{ property_id: "function_calling", value: "true" }]
      },
      {
        name: "openai/gpt-4.1",
        description: "A gateway tool model.",
        task: { name: "Text Generation" },
        properties: [{ property_id: "function_calling", value: true }]
      }
    ]);

    expect(models).toHaveLength(2);
    expect(models.find((model) => model.id === "@cf/openai/gpt-oss-20b")).toMatchObject({
      id: "@cf/openai/gpt-oss-20b",
      contextWindow: 128_000,
      reasoning: true,
      rates: {
        inputUsdPerMillion: 0.2,
        cachedInputUsdPerMillion: 0.2,
        outputUsdPerMillion: 0.3
      }
    });
    expect(models.find((model) => model.id === "openai/gpt-4.1")).toMatchObject({
      id: "openai/gpt-4.1",
      label: "GPT 4.1",
      requiresPaid: true
    });
  });

  it("loads every catalog page and removes duplicate model IDs", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      name: `openai/tool-model-${index}`,
      task: { name: "Text Generation" },
      properties: [{ property_id: "function_calling", value: true }]
    }));
    const models = vi.fn(async ({ page: pageNumber }: { page: number }) =>
      pageNumber === 1 ? page : [page[0], { ...page[0], name: "anthropic/claude-sonnet-4.5" }]
    );

    const result = await listHQBotModels({ models });

    expect(models).toHaveBeenCalledTimes(2);
    expect(result.length).toBeGreaterThan(101);
    expect(new Set(result.map((model) => model.id)).size).toBe(result.length);
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "anthropic/claude-sonnet-4.5" })])
    );
  });

  it("uses the safe built-in choices when catalog discovery fails", async () => {
    const models = vi.fn(async () => {
      throw new Error("Catalog unavailable");
    });

    await expect(listHQBotModels({ models })).resolves.toEqual(HQBOT_MODELS);
  });
});
