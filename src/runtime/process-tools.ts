import { type ToolSet, tool } from "ai";
import { z } from "zod";

const example = '{"processId":"hqbot-tool-0123456789abcdef0123456789abcdef"}';

export function createStopProcessTool(options: {
  stop: (processId: string) => Promise<{ processId: string; state: string }>;
}): ToolSet[string] {
  return tool({
    description:
      "Stop one managed Bash process and its child processes. Use the processId returned by bash. This requests durable cancellation and returns before cleanup finishes.",
    inputSchema: z.strictObject(
      {
        processId: z
          .string({ error: `stop_process requires processId. Valid example: ${example}` })
          .regex(/^hqbot-tool-[a-f0-9]{32}$/u, { error: example })
      },
      { error: `stop_process accepts only processId. Valid example: ${example}` }
    ),
    execute: ({ processId }) => options.stop(processId),
    toModelOutput: ({ output }) => ({ type: "text", value: JSON.stringify(output) })
  });
}
