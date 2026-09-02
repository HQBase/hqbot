import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { createStopProcessTool } from "../../src/runtime/process-tools";

async function execute(tool: ToolSet[string], input: unknown): Promise<unknown> {
  if (!tool.execute) throw new Error("Tool is not executable");
  return tool.execute(input, {
    abortSignal: undefined,
    context: undefined,
    messages: [],
    toolCallId: "stop-call"
  });
}

describe("stop process tool", () => {
  it("validates and forwards one managed process ID", async () => {
    const stop = vi.fn(async (processId: string) => ({ processId, state: "cancelling" }));
    const tool = createStopProcessTool({ stop });
    const processId = "hqbot-tool-0123456789abcdef0123456789abcdef";

    expect(() => (tool.inputSchema as z.ZodType).parse({ processId: "123" })).toThrow(
      /hqbot-tool/u
    );
    await expect(execute(tool, { processId })).resolves.toEqual({
      processId,
      state: "cancelling"
    });
    expect(stop).toHaveBeenCalledWith(processId);
  });
});
