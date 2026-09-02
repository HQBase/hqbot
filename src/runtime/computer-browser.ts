import type { Sandbox } from "@cloudflare/sandbox";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

import type { TeammateComputer } from "./computer";
import { openLinuxDesktop } from "./desktop";
import { screenshotModelOutput } from "./screenshot-model-output";

const BROWSER_COMMAND = "/usr/local/bin/hqbot-browser-control";
const MAX_SCREENSHOT_BYTES = 5_000_000;

interface BrowserToolsOptions {
  botId: string;
  computer: TeammateComputer;
  taskId: () => unknown;
}

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const url = z.string().max(2_000).refine(httpUrl, "Use an http(s) URL");
const targetId = z.string().min(1).max(200).optional();

async function runBrowser(
  options: BrowserToolsOptions,
  toolCallId: string,
  input: Record<string, unknown>
): Promise<{ sandbox: Sandbox; output: Record<string, unknown> }> {
  await options.computer.assertModelControlAvailable();
  const taskId = options.taskId();
  const sandbox = await options.computer.acquire({
    eventId: `browser:${toolCallId}`,
    taskId: typeof taskId === "string" ? taskId : null
  });
  await options.computer.assertModelControlAvailable();
  await openLinuxDesktop(sandbox, options.botId);
  await options.computer.assertModelControlAvailable();
  const result = await sandbox.exec(BROWSER_COMMAND, {
    env: { HQBOT_BROWSER_INPUT: JSON.stringify(input) },
    timeout: 30_000
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Chrome control failed");
  }
  const output: unknown = JSON.parse(result.stdout);
  if (!output || typeof output !== "object") throw new Error("Chrome returned invalid output");
  return { output: output as Record<string, unknown>, sandbox };
}

function modelText(value: unknown) {
  return { type: "text" as const, value: JSON.stringify(value) };
}

export function createComputerBrowserTools(options: BrowserToolsOptions): ToolSet {
  const open = tool({
    description:
      "Open an http(s) URL in the visible Chrome window on this teammate's Linux computer. The owner sees the same page in Computer.",
    inputSchema: z.object({ url, targetId }),
    execute: (input, context) =>
      runBrowser(options, context.toolCallId, { action: "open", ...input }).then(
        ({ output }) => output
      ),
    toModelOutput: ({ output }) => modelText(output)
  });

  const snapshot = tool({
    description:
      "Read the visible Chrome page and return its text plus stable element references for browser_click and browser_type.",
    inputSchema: z.object({ targetId }),
    execute: (input, context) =>
      runBrowser(options, context.toolCallId, { action: "snapshot", ...input }).then(
        ({ output }) => output
      ),
    toModelOutput: ({ output }) => modelText(output)
  });

  const evaluatePage = tool({
    description:
      "Run a JavaScript expression or function body in the visible Chrome page only when the structured browser tools are not enough. This has full page control. Never read passwords, passkeys, MFA codes, cookies, or browser storage, and never use it to bypass owner approval for an external action.",
    inputSchema: z.object({
      script: z.string().min(1).max(20_000),
      targetId
    }),
    execute: (input, context) =>
      runBrowser(options, context.toolCallId, { action: "evaluate", ...input }).then(
        ({ output }) => output
      ),
    toModelOutput: ({ output }) => modelText(output)
  });

  const click = tool({
    description:
      "Click one element reference from the latest browser snapshot in the same visible Chrome window.",
    inputSchema: z.object({ ref: z.string().regex(/^e\d+$/u), targetId }),
    execute: (input, context) =>
      runBrowser(options, context.toolCallId, { action: "click", ...input }).then(
        ({ output }) => output
      ),
    toModelOutput: ({ output }) => modelText(output)
  });

  const type = tool({
    description:
      "Type text into one element reference from the latest browser snapshot. Do not use this for passwords, passkeys, MFA codes, or CAPTCHAs; use computer_session to give control to the owner.",
    inputSchema: z.object({
      clear: z.boolean().optional().default(true),
      ref: z.string().regex(/^e\d+$/u),
      submit: z.boolean().optional().default(false),
      targetId,
      text: z.string().max(10_000)
    }),
    execute: (input, context) =>
      runBrowser(options, context.toolCallId, { action: "type", ...input }).then(
        ({ output }) => output
      ),
    toModelOutput: ({ output }) => modelText(output)
  });

  const press = tool({
    description:
      'Focus one element reference and press one key in the visible Chrome page. Use this for keyboard controls such as {"ref":"e14","key":"Enter"}.',
    inputSchema: z.object({
      alt: z.boolean().optional().default(false),
      ctrl: z.boolean().optional().default(false),
      key: z.string().min(1).max(40),
      meta: z.boolean().optional().default(false),
      ref: z.string().regex(/^e\d+$/u),
      shift: z.boolean().optional().default(false),
      targetId
    }),
    execute: (input, context) =>
      runBrowser(options, context.toolCallId, { action: "press", ...input }).then(
        ({ output }) => output
      ),
    toModelOutput: ({ output }) => modelText(output)
  });

  const tabs = tool({
    description: "List, open, select, or close tabs in the same visible Chrome window.",
    inputSchema: z
      .discriminatedUnion("operation", [
        z.object({ operation: z.literal("list") }),
        z.object({ operation: z.literal("new"), url }),
        z.object({ operation: z.literal("select"), targetId: z.string().min(1).max(200) }),
        z.object({ operation: z.literal("close"), targetId: z.string().min(1).max(200) })
      ])
      .describe("The tab operation."),
    execute: (input, context) =>
      runBrowser(options, context.toolCallId, { action: "tabs", ...input }).then(
        ({ output }) => output
      ),
    toModelOutput: ({ output }) => modelText(output)
  });

  const screenshot = tool({
    description: "Capture the visible Chrome viewport so you and the owner can inspect it.",
    inputSchema: z.object({ targetId }),
    execute: async (input, context) => {
      const path = `/tmp/hqbot-browser-${crypto.randomUUID()}.jpg`;
      const { output, sandbox } = await runBrowser(options, context.toolCallId, {
        action: "screenshot",
        path,
        ...input
      });
      try {
        const image = await sandbox.readFile(path, { encoding: "base64" });
        const size = image.size ?? Math.floor((image.content.length * 3) / 4);
        if (size <= 0 || size > MAX_SCREENSHOT_BYTES) {
          throw new Error("The browser screenshot is too large");
        }
        return {
          data: image.content,
          mediaType: "image/jpeg" as const,
          type: "browser_screenshot" as const,
          url: typeof output.url === "string" ? output.url : undefined
        };
      } finally {
        await sandbox.deleteFile(path).catch(() => undefined);
      }
    },
    toModelOutput: ({ output }) =>
      screenshotModelOutput({
        data: output.data,
        description: output.url ? `Browser screenshot of ${output.url}.` : "Browser screenshot.",
        filename: "browser-screenshot.jpg",
        mediaType: output.mediaType
      })
  });

  return {
    browser_click: click,
    browser_evaluate: evaluatePage,
    browser_open: open,
    browser_press: press,
    browser_screenshot: screenshot,
    browser_snapshot: snapshot,
    browser_tabs: tabs,
    browser_type: type
  };
}
