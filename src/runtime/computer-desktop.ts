import type { Sandbox } from "@cloudflare/sandbox";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

import type { TeammateComputer } from "./computer";
import { openLinuxDesktop } from "./desktop";
import { screenshotModelOutput } from "./screenshot-model-output";

const DESKTOP_COMMAND = "/usr/local/bin/hqbot-desktop-control";
const MAX_SCREENSHOT_BYTES = 5_000_000;

interface DesktopToolsOptions {
  botId: string;
  computer: TeammateComputer;
  taskId: () => unknown;
}

const numberText = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;
const boundedInteger = (minimum: number, maximum: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && numberText.test(value) ? Number(value) : value),
    z.number().int().min(minimum).max(maximum)
  );
const coordinate = boundedInteger(0, 10_000);
const button = z.enum(["left", "middle", "right"]);

function stoppedContainer(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /container (?:failed to start|is not running)/iu.test(message);
}

async function runDesktop(
  options: DesktopToolsOptions,
  toolCallId: string,
  input: Record<string, unknown>
): Promise<{ sandbox: Sandbox; output: Record<string, unknown> }> {
  await options.computer.assertModelControlAvailable();
  const taskId = options.taskId();
  const sandbox = await options.computer.acquire({
    eventId: `desktop:${toolCallId}`,
    taskId: typeof taskId === "string" ? taskId : null
  });
  await options.computer.assertModelControlAvailable();
  await openLinuxDesktop(sandbox, options.botId);
  await options.computer.assertModelControlAvailable();
  const result = await sandbox.exec(DESKTOP_COMMAND, {
    env: { DISPLAY: ":99", HQBOT_DESKTOP_INPUT: JSON.stringify(input) },
    timeout: 20_000
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Desktop control failed");
  }
  const output: unknown = JSON.parse(result.stdout);
  if (!output || typeof output !== "object") throw new Error("Desktop returned invalid output");
  return { output: output as Record<string, unknown>, sandbox };
}

function modelText(value: unknown) {
  return { type: "text" as const, value: JSON.stringify(value) };
}

export function createComputerDesktopTools(options: DesktopToolsOptions): ToolSet {
  const session = tool({
    description:
      "Manage the shared Linux computer. Start it when the owner asks. Give control to the owner when they ask or must enter a password, passkey, MFA code, or CAPTCHA. Take control back after the owner says they are done. Stop it only when the owner asks and no work is running.",
    inputSchema: z.discriminatedUnion("action", [
      z.object({ action: z.literal("start") }),
      z.object({ action: z.literal("give_to_owner") }),
      z.object({ action: z.literal("take_back") }),
      z.object({ action: z.literal("stop") })
    ]),
    execute: async (input, context) => {
      const taskId = options.taskId();
      if (input.action === "stop") {
        await options.computer.stop();
      } else if (input.action === "take_back") {
        await options.computer.setOwnerControl(false);
      } else {
        await options.computer.open({
          eventId: `session:${context.toolCallId}`,
          taskId: typeof taskId === "string" ? taskId : null
        });
        if (input.action === "give_to_owner") {
          try {
            await options.computer.setOwnerControl(true);
          } catch (cause) {
            if (!stoppedContainer(cause)) throw cause;
            await options.computer.open({
              eventId: `session:${context.toolCallId}:retry`,
              taskId: typeof taskId === "string" ? taskId : null
            });
            await options.computer.setOwnerControl(true);
          }
        }
      }
      return { action: input.action, status: await options.computer.status() };
    },
    toModelOutput: ({ output }) => modelText(output)
  });

  const screenshot = tool({
    description:
      "Capture the whole visible Linux desktop. Use the returned image dimensions for desktop_mouse coordinates.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const path = `/tmp/hqbot-desktop-${crypto.randomUUID()}.jpg`;
      const { output, sandbox } = await runDesktop(options, context.toolCallId, {
        action: "screenshot",
        path
      });
      try {
        const image = await sandbox.readFile(path, { encoding: "base64" });
        const size = image.size ?? Math.floor((image.content.length * 3) / 4);
        if (size <= 0 || size > MAX_SCREENSHOT_BYTES) {
          throw new Error("The desktop screenshot is too large");
        }
        return {
          data: image.content,
          height: output.height,
          mediaType: "image/jpeg" as const,
          type: "desktop_screenshot" as const,
          width: output.width
        };
      } finally {
        await sandbox.deleteFile(path).catch(() => undefined);
      }
    },
    toModelOutput: ({ output }) =>
      screenshotModelOutput({
        data: output.data,
        description: `Desktop screenshot: ${String(output.width)} by ${String(output.height)} pixels.`,
        filename: "desktop-screenshot.jpg",
        mediaType: output.mediaType
      })
  });

  const mouse = tool({
    description:
      "Control the pointer on the visible Linux desktop. Coordinates start at the top-left of the latest desktop screenshot.",
    inputSchema: z.discriminatedUnion("action", [
      z.object({ action: z.literal("move"), x: coordinate, y: coordinate }),
      z.object({
        action: z.literal("click"),
        button: button.optional().default("left"),
        count: boundedInteger(1, 3).optional().default(1),
        x: coordinate,
        y: coordinate
      }),
      z.object({
        action: z.literal("drag"),
        button: button.optional().default("left"),
        fromX: coordinate,
        fromY: coordinate,
        toX: coordinate,
        toY: coordinate
      }),
      z
        .object({
          action: z.literal("scroll"),
          deltaX: boundedInteger(-20, 20).optional().default(0),
          deltaY: boundedInteger(-20, 20).optional().default(0),
          x: coordinate,
          y: coordinate
        })
        .refine((input) => input.deltaX !== 0 || input.deltaY !== 0, "Scroll must move")
    ]),
    execute: (input, context) =>
      runDesktop(options, context.toolCallId, input).then(({ output }) => output),
    toModelOutput: ({ output }) => modelText(output)
  });

  const keyboard = tool({
    description:
      'Type text or press keys in the focused Linux desktop app. Press example: {"action":"press","keys":["ctrl+l","Return"]}. Never use this for passwords, passkeys, MFA codes, or CAPTCHAs; use computer_session to give control to the owner.',
    inputSchema: z
      .object({
        action: z.enum(["type", "press"]),
        keys: z
          .array(
            z
              .string()
              .min(1)
              .max(80)
              .regex(/^[A-Za-z0-9_+:]+$/u),
            {
              error:
                'keys must be an array. Valid example: {"action":"press","keys":["ctrl+l","Return"]}'
            }
          )
          .min(1)
          .max(20)
          .optional(),
        text: z.string().min(1).max(10_000).optional()
      })
      .superRefine((input, context) => {
        if (input.action === "press" && !input.keys) {
          context.addIssue({
            code: "custom",
            message:
              'desktop_keyboard press needs keys. Valid example: {"action":"press","keys":["ctrl+l","Return"]}',
            path: ["keys"]
          });
        }
        if (input.action === "type" && !input.text) {
          context.addIssue({
            code: "custom",
            message:
              'desktop_keyboard type needs text. Valid example: {"action":"type","text":"hello"}',
            path: ["text"]
          });
        }
      }),
    execute: (input, context) =>
      runDesktop(options, context.toolCallId, input).then(({ output }) => output),
    toModelOutput: ({ output }) => modelText(output)
  });

  return {
    computer_session: session,
    desktop_keyboard: keyboard,
    desktop_mouse: mouse,
    desktop_screenshot: screenshot
  };
}
