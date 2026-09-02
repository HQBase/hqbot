import type { Process, ProcessStatus } from "@cloudflare/sandbox";

import type { TeammateComputer } from "./computer";
import { LinuxOutputError } from "./linux-output";
import {
  cleanupLinuxRun,
  type LinuxProcessCompletion,
  type LinuxRunOptions,
  publishLinuxOutputs
} from "./linux-shell";
import type { TaskCoordinator } from "./task-coordinator";
import type { WorkspaceAgentRpc } from "./types";
import type { ActiveWork, ManagedLinuxProcess, TeammateLinuxProcessStore } from "./work";

const MAX_OUTPUT_CHARS = 64_000;
const DEFAULT_SANDBOX_CALL_TIMEOUT_MS = 30_000;

export interface LinuxProcessPollPayload {
  generation: number;
  processId: string;
  taskId: string;
  token: number;
}

export interface ManagedLinuxProcessOptions {
  addAssistantMessage: (id: string, text: string) => Promise<void>;
  botId: string;
  bucket: Env["ARTIFACTS"];
  cancelSchedule: (id: string) => Promise<unknown>;
  computer: () => TeammateComputer;
  isActiveTaskTurn: (work: ActiveWork) => boolean;
  inlineWaitMs?: number;
  markInteraction: (summary: string) => Promise<void>;
  pollTimeoutMs?: number;
  processStore: TeammateLinuxProcessStore;
  schedulePoll: (when: Date, payload: LinuxProcessPollPayload) => Promise<{ id: string }>;
  scheduleRecovery?: (when: Date) => Promise<unknown>;
  tasks: TaskCoordinator;
  transactionSync: <T>(closure: () => T) => T;
  workspaceAgent: WorkspaceAgentRpc;
}

function boundedOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`;
}

function recoveryError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Unknown Sandbox recovery error";
  return message.replace(/\s+/gu, " ").trim().slice(0, 500) || "Unknown Sandbox recovery error";
}

export abstract class ManagedLinuxRecovery {
  constructor(protected readonly options: ManagedLinuxProcessOptions) {}

  active(): ManagedLinuxProcess | null {
    return this.options.processStore.active();
  }

  current(): ManagedLinuxProcess | null {
    return this.options.processStore.current();
  }

  protected runOptions(): LinuxRunOptions {
    return {
      botId: this.options.botId,
      bucket: this.options.bucket,
      catalog: this.options.workspaceAgent,
      sandbox: this.options.computer().sandbox()
    };
  }

  protected sandboxCall<T>(
    operation: Promise<T>,
    operationName: string,
    timeoutOverrideMs?: number
  ): Promise<T> {
    const timeoutMs =
      timeoutOverrideMs ?? this.options.pollTimeoutMs ?? DEFAULT_SANDBOX_CALL_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`${operationName} timed out after ${timeoutMs} ms`)),
        timeoutMs
      );
      operation.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (cause) => {
          clearTimeout(timeout);
          reject(cause);
        }
      );
    });
  }

  protected async finalize(
    process: Process,
    status: ProcessStatus,
    latest: ManagedLinuxProcess,
    work: ActiveWork
  ): Promise<void> {
    const exitCode = process.exitCode ?? (status === "completed" ? 0 : 1);
    const resultReady = await this.captureProcessResult(exitCode, latest);
    if (!resultReady) return;
    await this.recoverResult(work, resultReady);
  }

  protected async captureProcessResult(
    exitCode: number,
    latest: ManagedLinuxProcess
  ): Promise<ManagedLinuxProcess | null> {
    const logs = await this.sandboxCall(
      this.options.computer().sandbox().getProcessLogs(latest.processId),
      "Sandbox process logs"
    );
    return this.captureResult(
      {
        durationMs: Math.max(0, Date.now() - Date.parse(latest.startedAt)),
        exitCode,
        stderr: logs.stderr,
        stdout: logs.stdout
      },
      latest
    );
  }

  protected async captureResult(
    completion: LinuxProcessCompletion,
    latest: ManagedLinuxProcess
  ): Promise<ManagedLinuxProcess | null> {
    let exitCode = completion.exitCode;
    let stderr = completion.stderr;
    let files: Awaited<ReturnType<typeof publishLinuxOutputs>> = [];
    if (exitCode === 0) {
      try {
        files = await publishLinuxOutputs(this.runOptions(), latest.outputRoot, latest.outputs);
      } catch (cause) {
        if (!(cause instanceof LinuxOutputError)) throw cause;
        exitCode = 1;
        stderr = [stderr, `HQBot could not save the declared output: ${cause.message}`]
          .filter(Boolean)
          .join("\n");
      }
    }
    const resultReady = await this.options.tasks.run(async () => {
      const current = this.current();
      if (
        !current ||
        current.processId !== latest.processId ||
        current.pollToken !== latest.pollToken ||
        current.state !== "finalizing"
      )
        return null;
      return this.options.processStore.put({
        ...current,
        failureCount: 0,
        result: {
          durationMs: completion.durationMs,
          exitCode,
          files,
          stderr: boundedOutput(stderr),
          stdout: boundedOutput(completion.stdout)
        },
        updatedAt: new Date().toISOString()
      });
    });
    return resultReady;
  }

  protected async recoverResult(work: ActiveWork, process: ManagedLinuxProcess): Promise<void> {
    if (!process.result) return;
    await this.sandboxCall(
      cleanupLinuxRun(this.runOptions(), process.runRoot, process.staged),
      "Sandbox process cleanup"
    );
    const completed = await this.options.tasks.run(async () => {
      const current = this.current();
      const latestWork = this.options.tasks.current();
      if (
        !current ||
        current.processId !== process.processId ||
        !current.result ||
        current.state !== "finalizing" ||
        !latestWork ||
        latestWork.taskId !== work.taskId ||
        latestWork.generation !== work.generation ||
        latestWork.state !== "waiting"
      )
        return null;
      return this.options.processStore.put({
        ...current,
        state: current.result.exitCode === 0 ? "completed" : "failed",
        updatedAt: new Date().toISOString()
      });
    });
    if (!completed) return;
    if (completed.pollScheduleId) {
      await this.options.cancelSchedule(completed.pollScheduleId).catch(() => false);
    }
    await this.continueAfterResult(work, completed);
  }

  protected async finishCancellation(process: ManagedLinuxProcess): Promise<void> {
    const sandbox = this.options.computer().sandbox();
    const running = await this.sandboxCall(
      sandbox.getProcess(process.processId),
      "Sandbox process lookup"
    );
    if (running) await this.sandboxCall(running.kill("SIGTERM"), "Sandbox process stop");
    await this.sandboxCall(
      cleanupLinuxRun(this.runOptions(), process.runRoot, process.staged),
      "Sandbox process cleanup"
    ).catch(() => undefined);
    const scheduleId = await this.options.tasks.run(async () => {
      const current = this.current();
      if (current?.processId !== process.processId || current.state !== "cancelling") return null;
      this.options.processStore.put({
        ...current,
        state: "cancelled",
        updatedAt: new Date().toISOString()
      });
      return current.pollScheduleId;
    });
    if (scheduleId) await this.options.cancelSchedule(scheduleId).catch(() => false);
    await this.options
      .computer()
      .stop()
      .catch(() => undefined);
  }

  protected async markUncertain(
    process: ManagedLinuxProcess,
    work: ActiveWork,
    cause: unknown
  ): Promise<void> {
    const error = recoveryError(cause);
    const outcome = await this.options.tasks.run(async () => {
      const current = this.options.tasks.current();
      const descriptor = this.current();
      if (
        !current ||
        current.taskId !== work.taskId ||
        current.generation !== work.generation ||
        current.state !== work.state ||
        !descriptor ||
        descriptor.processId !== process.processId ||
        descriptor.pollToken !== process.pollToken
      )
        return null;
      this.options.processStore.put({
        ...descriptor,
        state: "uncertain",
        updatedAt: new Date().toISOString()
      });
      const uncertain = this.options.tasks.transition(current, {
        ...current,
        state: "uncertain",
        lastError: `Bash recovery failed before its deadline: ${error}`,
        updatedAt: new Date().toISOString()
      });
      return uncertain ? { scheduleId: descriptor.pollScheduleId, work: uncertain } : null;
    });
    if (!outcome) return;
    if (outcome.scheduleId) {
      await this.options.cancelSchedule(outcome.scheduleId).catch(() => false);
    }
    try {
      await this.options.tasks.syncProjection(outcome.work);
    } catch {
      await this.options.scheduleRecovery?.(new Date(Date.now() + 1_000)).catch(() => undefined);
    }
    await this.options.addAssistantMessage(
      `process-uncertain:${process.processId}`,
      `I could not verify the Bash result before its deadline. The last recovery error was: ${error}. The command might have changed an external system, so I did not run it again. Please check its result before we continue.`
    );
    await this.options.markInteraction("Bash command needs review");
  }

  protected async continueAfterResult(
    work: ActiveWork,
    process: ManagedLinuxProcess
  ): Promise<void> {
    if (!process.result) return;
    const fileSummary = process.result.files
      .map((file) => `- ${file.name} (${file.id})`)
      .join("\n");
    const checkpoint = [
      `Linux process ${process.processId} finished with exit code ${process.result.exitCode}.`,
      process.result.stdout ? `stdout:\n${process.result.stdout}` : "",
      process.result.stderr ? `stderr:\n${process.result.stderr}` : "",
      fileSummary ? `Saved files:\n${fileSummary}` : ""
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 20_000);
    const next = await this.options.tasks.continueFrom(work, checkpoint);
    if (next.state !== "uncertain") return;
    await this.options.addAssistantMessage(
      `process-unscheduled:${process.processId}`,
      `${checkpoint}\n\nI could not start the next AI turn. Send me a message to continue from this saved result.`
    );
  }
}
