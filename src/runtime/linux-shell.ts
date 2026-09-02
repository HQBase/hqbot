import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";

import type { ArtifactBucket, ArtifactCatalog } from "../services/artifacts";
import { publishLinuxOutputs } from "./linux-output";
import {
  cleanupLinuxRun,
  type LinuxRunOptions,
  type LinuxSandbox,
  linuxProcessOptions,
  type PreparedLinuxRun,
  prepareLinuxRun
} from "./linux-run";

export type {
  LinuxOutputSpec,
  LinuxProcessCompletion,
  LinuxRunOptions,
  LinuxSandbox,
  PreparedLinuxRun
} from "./linux-run";
export {
  cleanupLinuxRun,
  LINUX_HOME,
  LINUX_RUNNER_COMMAND,
  LINUX_RUNS,
  LINUX_WORKSPACE,
  linuxProcessOptions,
  prepareLinuxRun
} from "./linux-run";
export { publishLinuxOutputs };

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_COMMAND_OUTPUT_CHARS = 64_000;

export interface StartLinuxProcessInput {
  fingerprint: string;
  run: PreparedLinuxRun;
  toolCallId: string;
}

export interface ResumeLinuxProcessInput {
  fingerprint: string;
  toolCallId: string;
}

export interface LinuxProcessHandoff {
  processId: string;
  state: "cancelling" | "running" | "uncertain";
  taskId: string;
  type: "sandbox_process";
}

export interface LinuxCommandResult {
  type: "sandbox_command";
  durationMs: number;
  exitCode: number;
  files: Awaited<ReturnType<typeof publishLinuxOutputs>>;
  stderr: string;
  stdout: string;
}

export type LinuxProcessResult = LinuxCommandResult | LinuxProcessHandoff;

export class LinuxProcessStartRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinuxProcessStartRejected";
  }
}

interface LinuxBashOptions {
  acquireSandbox?: (toolCallId: string) => Promise<LinuxSandbox>;
  beforeExec?: () => Promise<void>;
  botId: string;
  bucket: ArtifactBucket;
  catalog: ArtifactCatalog;
  recordSandboxUse?: (toolCallId: string) => Promise<void>;
  resumeProcess?: (input: ResumeLinuxProcessInput) => Promise<LinuxProcessResult | null>;
  sandbox: () => LinuxSandbox;
  startProcess?: (input: StartLinuxProcessInput) => Promise<LinuxProcessResult>;
  stopSandbox?: (checkpoint: boolean) => Promise<void>;
}

const commandInput = z.strictObject(
  {
    script: z
      .string({
        error: 'bash requires the script field. Valid example: {"script":"printf \'hello\\n\'"}'
      })
      .min(1)
      .max(20_000)
  },
  { error: 'bash accepts only script. Valid example: {"script":"pwd"}' }
);

const detachedWork =
  /\b(?:nohup|disown|setsid)\b|\bwhile\s+(?:true|:)\b|\bfor\s*\(\s*\(\s*;\s*;\s*\)\s*\)/u;

function bounded(value: string): string {
  if (value.length <= MAX_COMMAND_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_COMMAND_OUTPUT_CHARS)}\n[output truncated]`;
}

function modelBounded(value: string): string {
  const maximum = 8_000;
  if (value.length <= maximum) return value;
  const side = Math.floor((maximum - 40) / 2);
  return `${value.slice(0, side)}\n[model output truncated]\n${value.slice(-side)}`;
}

const bashExecutionTails = new Map<string, Promise<void>>();

function runBashExclusive<T>(botId: string, operation: () => Promise<T>): Promise<T> {
  const previous = bashExecutionTails.get(botId) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  bashExecutionTails.set(botId, tail);
  return result.finally(() => {
    if (bashExecutionTails.get(botId) === tail) bashExecutionTails.delete(botId);
  });
}

async function stopAfterCommand(options: LinuxRunOptions, checkpoint: boolean): Promise<void> {
  if (options.stopSandbox) await options.stopSandbox(checkpoint);
  else await options.sandbox.stop();
}

async function discardPreparedRun(options: LinuxRunOptions, run: PreparedLinuxRun): Promise<void> {
  try {
    await cleanupLinuxRun(options, run.runRoot, run.staged);
  } catch {
    await stopAfterCommand(options, false).catch(() => undefined);
  }
}

export function createLinuxBashTool(options: LinuxBashOptions): ToolSet[string] {
  let usageRecorded = false;
  let lastFailedInput: string | null = null;
  return tool({
    description:
      'Run one bounded Bash command in /workspace/hqbot on this teammate\'s real Cloudflare Linux computer. Files remain local until upload_file saves one to durable Files. HQBot automatically keeps a slow command running and continues in a later turn. Valid example: {"script":"printf \'hello\\n\' > note.txt"}',
    inputSchema: commandInput,
    execute: async ({ script }, context) =>
      runBashExclusive(options.botId, async () => {
        if (detachedWork.test(script)) {
          throw new Error(
            'Bash runs one bounded command. For monitoring or repeated work, use schedule. Valid example: {"action":"create_recurring","name":"Monitor mail","prompt":"Check for new mail and handle it","everyMinutes":5}'
          );
        }
        const fingerprint = JSON.stringify({ script });
        if (fingerprint === lastFailedInput) {
          throw new Error(
            "This exact Bash call already failed. Change the input or use another tool."
          );
        }
        const resumed = await options.resumeProcess?.({
          fingerprint,
          toolCallId: context.toolCallId
        });
        if (resumed) return resumed;
        if (!usageRecorded) {
          await options.recordSandboxUse?.(context.toolCallId);
          usageRecorded = true;
        }
        const runOptions: LinuxRunOptions = {
          ...options,
          sandbox: options.acquireSandbox
            ? await options.acquireSandbox(context.toolCallId)
            : options.sandbox()
        };
        await runOptions.beforeExec?.();
        context.abortSignal?.throwIfAborted();
        const run = await prepareLinuxRun(runOptions, { script });
        if (options.startProcess) {
          try {
            await runOptions.beforeExec?.();
            context.abortSignal?.throwIfAborted();
          } catch (cause) {
            await discardPreparedRun(runOptions, run);
            throw cause;
          }
          try {
            const result = await options.startProcess({
              fingerprint,
              run,
              toolCallId: context.toolCallId
            });
            lastFailedInput =
              result.type === "sandbox_command" && result.exitCode !== 0 ? fingerprint : null;
            return result;
          } catch (cause) {
            if (cause instanceof LinuxProcessStartRejected) {
              await discardPreparedRun(runOptions, run);
            }
            lastFailedInput = fingerprint;
            throw cause;
          }
        }
        let cleanupAttempted = false;
        try {
          let result: Awaited<ReturnType<LinuxSandbox["exec"]>>;
          await runOptions.beforeExec?.();
          try {
            context.abortSignal?.throwIfAborted();
            const process = linuxProcessOptions(run);
            result = await runOptions.sandbox.exec(process.command, {
              ...process.options,
              timeout: COMMAND_TIMEOUT_MS
            });
          } catch (cause) {
            cleanupAttempted = true;
            let cleaned = false;
            try {
              await cleanupLinuxRun(runOptions, run.runRoot, run.staged);
              cleaned = true;
            } catch {
              // A stop without a new checkpoint prevents temporary data from becoming durable.
            }
            await stopAfterCommand(runOptions, cleaned).catch(() => undefined);
            throw cause;
          }
          const output: LinuxCommandResult = {
            type: "sandbox_command",
            durationMs: result.duration,
            exitCode: result.exitCode,
            files: [],
            stderr: bounded(result.stderr),
            stdout: bounded(result.stdout)
          };
          lastFailedInput = output.exitCode === 0 ? null : fingerprint;
          return output;
        } catch (cause) {
          lastFailedInput = fingerprint;
          throw cause;
        } finally {
          if (!cleanupAttempted) {
            try {
              await cleanupLinuxRun(runOptions, run.runRoot, run.staged);
            } catch {
              await stopAfterCommand(runOptions, false).catch(() => undefined);
            }
          }
        }
      }),
    toModelOutput: ({ output }) =>
      output.type === "sandbox_process"
        ? {
            type: "text",
            value: `Process ${output.processId} is ${output.state} for task ${output.taskId}. HQBot will check the same process and continue automatically. Do not call manage_task or run the command again.`
          }
        : {
            type: "text",
            value: [
              `Exit code: ${output.exitCode}`,
              output.stdout ? `stdout:\n${modelBounded(output.stdout)}` : "",
              output.stderr ? `stderr:\n${modelBounded(output.stderr)}` : "",
              output.files.length > 0
                ? `Saved to Files:\n${output.files
                    .map((file) => `- ${file.name} (${file.id})`)
                    .join("\n")}`
                : ""
            ]
              .filter(Boolean)
              .join("\n\n")
          }
  });
}
