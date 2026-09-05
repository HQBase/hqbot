import type { LanguageModel } from "ai";
import { expect, it, vi } from "vitest";
import { budgetedModel } from "../../src/runtime/model-budget";

type Model = Extract<LanguageModel, { specificationVersion: "v4" }>;
const usage = {
  inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 }
};
function fixture(block = false) {
  const order: string[] = [];
  const reserveModelRequest = vi.fn(async () => {
    order.push("reserve");
    if (block) throw new Error("budget exceeded");
  });
  const recordUsage = vi.fn(async () => {
    order.push("settle");
  });
  const doGenerate = vi.fn<Model["doGenerate"]>(async (params) => {
    order.push("generate");
    expect(params.maxOutputTokens).toBe(5000);
    return { content: [], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
  });
  const model: Model = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    doGenerate,
    doStream: async () => {
      order.push("stream");
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop" as const, raw: "stop" },
              usage
            });
            controller.close();
          }
        })
      };
    }
  };
  const wrapped = budgetedModel({
    model,
    modelId: "@cf/zai-org/glm-5.3-flash",
    botId: "bot",
    taskId: () => "task",
    workspace: { reserveModelRequest, recordUsage } as never,
    rates: async () => null
  }) as Model;
  return { wrapped, order, doGenerate, recordUsage, reserveModelRequest };
}
it("reserves before each provider attempt and blocks calls when the reservation fails", async () => {
  const pass = fixture();
  await pass.wrapped.doGenerate({ prompt: [], maxOutputTokens: 10000 });
  expect(pass.order).toEqual(["reserve", "generate", "settle"]);
  expect(pass.recordUsage).toHaveBeenCalledWith(
    expect.objectContaining({ inputTokens: 100, outputTokens: 10, unpriced: true, taskId: "task" })
  );
  const blocked = fixture(true);
  await expect(blocked.wrapped.doGenerate({ prompt: [] })).rejects.toThrow("budget exceeded");
  expect(blocked.doGenerate).not.toHaveBeenCalled();
  expect(blocked.recordUsage).not.toHaveBeenCalled();
});
it("settles streaming usage once after the finish event", async () => {
  const run = fixture();
  const result = await run.wrapped.doStream({ prompt: [] });
  const reader = result.stream.getReader();
  while (!(await reader.read()).done) {
    /* Drain the provider stream. */
  }
  expect(run.order).toEqual(["reserve", "stream", "settle"]);
  expect(run.recordUsage).toHaveBeenCalledOnce();
});
