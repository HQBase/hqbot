import { MockLanguageModelV4 } from "ai/test";
import { expect, it } from "vitest";
import { describeRecording } from "../../src/runtime/demonstration-draft";

const item = {
  id: "6f8e53d5-f1c8-4240-8b40-06b44314f50f",
  botId: "bot",
  name: "Report",
  notes: "Check totals",
  videoId: "video",
  frames: [{ fileId: "image", seconds: 5 }]
};
function model(text: string) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 50, text: 50, reasoning: 0 }
      },
      warnings: []
    }
  });
}
it("passes the selected frame to the model and produces structured instructions without tool access", async () => {
  const provider = model(
    JSON.stringify({
      description: "Prepare a report",
      instructions:
        "Untested draft. Read the visible totals. Check the values. Review unseen steps before use."
    })
  );
  const result = await describeRecording(provider, item, [
    { seconds: 5, data: new Uint8Array([255, 216, 255]), mediaType: "image/jpeg" }
  ]);
  expect(result.description).toBe("Prepare a report");
  expect(provider.doGenerateCalls).toHaveLength(1);
  expect(provider.doGenerateCalls[0]?.tools ?? []).toHaveLength(0);
  expect(JSON.stringify(provider.doGenerateCalls[0]?.prompt)).toContain("image/jpeg");
});
it("rejects an invalid model draft instead of storing arbitrary output", async () => {
  await expect(
    describeRecording(model('{"description":"bad","instructions":""}'), item, [])
  ).rejects.toThrow();
});
