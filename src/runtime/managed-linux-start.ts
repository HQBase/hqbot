import type { Process } from "@cloudflare/sandbox";

import {
  cleanupLinuxRun,
  type LinuxCommandResult,
  type LinuxProcessHandoff,
  type LinuxProcessResult,
  LinuxProcessStartRejected,
  linuxProcessOptions,
  type ResumeLinuxProcessInput,
  type StartLinuxProcessInput
} from "./linux-shell";
import { ManagedLinuxRecovery } from "./managed-linux-recovery";
import type { ActiveWork, ManagedLinuxProcess } from "./work";

const PROCESS_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
export const PROCESS_POLL_INTERVAL_MS = 5_000;
const INLINE_WAIT_MS = 5_000;
const INLINE_POLL_START_MS = 100;
const INLINE_POLL_MAX_MS = 1_000;

function isRunning(process: Process): boolean {
  return process.status === "starting" || process.status === "running";
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function stableProcessId(botId: string, input: ResumeLinuxProcessInput): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${botId}\u0000${input.toolCallId}\u0000${input.fingerprint}`)
  );
  return `hqbot-tool-${bytesToHex(digest).slice(0, 32)}`;
}

export class ManagedLinuxProcessStart extends ManagedLinuxRecovery {
  async resume(input: ResumeLinuxProcessInput): Promise<LinuxProcessResult | null> {
    const processId = await stableProcessId(this.options.botId, input);
    const process = this.current();
    if (!process || process.processId !== processId) return null;
    const work = this.options.tasks.current();
    if (
      work?.taskId === process.taskId &&
      work.generation === process.generation &&
      work.state === "waiting"
    ) {
      await this.options.tasks.syncProjection(work).catch(() => undefined);
      return this.handoffResult(process);
    }
    if (process.result && ["completed", "failed"].includes(process.state)) {
      return this.commandResult(process);
    }
    return this.handoffResult(process);
  }

  async start(input: StartLinuxProcessInput): Promise<LinuxProcessResult> {
    const processId = await stableProcessId(this.options.botId, input);
    const replay = await this.resume(input);
    if (replay) return replay;
    if (this.active()) throw new LinuxProcessStartRejected("A Bash process is already running");

    const current = this.options.tasks.active();
    const predecessor = this.options.tasks.current();
    const sameTaskTurn = Boolean(
      current?.state === "running" && this.options.isActiveTaskTurn(current)
    );
    const timestamp = new Date().toISOString();
    const taskId = current?.taskId ?? crypto.randomUUID();
    const generation =
      sameTaskTurn && current ? current.generation : (current?.generation ?? 0) + 1;
    const nextWork: ActiveWork = {
      taskId,
      goal: current?.goal ?? "Complete the requested Linux work",
      checkpoint: `Linux process ${processId} is running.`,
      state: "waiting",
      generation,
      wakeAt: null,
      scheduleId: null,
      submissionId: sameTaskTurn && current ? current.submissionId : null,
      lastError: null,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    const descriptor: ManagedLinuxProcess = {
      processId,
      taskId,
      generation,
      state: "preparing",
      runRoot: input.run.runRoot,
      outputRoot: input.run.outputRoot,
      scriptPath: input.run.scriptPath,
      staged: input.run.staged,
      outputs: input.run.outputs,
      failureCount: 0,
      pollScheduleId: null,
      pollToken: 0,
      startedAt: timestamp,
      deadlineAt: new Date(Date.now() + PROCESS_TIMEOUT_MS).toISOString(),
      result: null,
      updatedAt: timestamp
    };
    const savedWork = this.options.transactionSync(() => {
      const saved = this.options.tasks.transition(predecessor, nextWork);
      if (!saved) {
        throw new LinuxProcessStartRejected("The task changed before the process started");
      }
      this.options.processStore.put(descriptor);
      return saved;
    });

    let armed: ManagedLinuxProcess;
    try {
      armed = await this.armPoll(descriptor);
    } catch (cause) {
      this.options.transactionSync(() => {
        const latest = this.current();
        if (latest?.processId === descriptor.processId) {
          this.options.processStore.put({
            ...latest,
            state: "failed",
            updatedAt: new Date().toISOString()
          });
        }
        this.restoreInlineWork(savedWork, predecessor, "The process could not be watched");
      });
      throw new LinuxProcessStartRejected(
        cause instanceof Error ? cause.message : "The process could not be watched"
      );
    }

    const command = linuxProcessOptions(input.run);
    let process: Process;
    try {
      process = await this.options
        .computer()
        .sandbox()
        .startProcess(command.command, {
          ...command.options,
          autoCleanup: false,
          processId,
          timeout: PROCESS_TIMEOUT_MS
        });
    } catch {
      return this.handoff(savedWork, predecessor, armed);
    }
    const latest = this.current();
    if (
      !latest ||
      latest.processId !== processId ||
      latest.state === "cancelling" ||
      latest.state === "cancelled"
    ) {
      await this.options
        .computer()
        .sandbox()
        .killProcess(processId, "SIGTERM")
        .catch(() => undefined);
      return this.handoffResult(latest ?? armed);
    }
    if (latest.state === "preparing") {
      armed = this.options.processStore.put({
        ...latest,
        state: "running",
        updatedAt: new Date().toISOString()
      });
    }
    const inlineWaitMs = this.options.inlineWaitMs ?? INLINE_WAIT_MS;
    const exitCode = await this.waitForInlineExit(process, inlineWaitMs);
    if (exitCode !== null) {
      return await this.finishInline(exitCode, armed, savedWork, predecessor);
    }
    return this.handoff(savedWork, predecessor, armed);
  }

  protected async armPoll(
    process: ManagedLinuxProcess,
    delayMs = PROCESS_POLL_INTERVAL_MS
  ): Promise<ManagedLinuxProcess> {
    const token = process.pollToken + 1;
    const schedule = await this.options.schedulePoll(new Date(Date.now() + delayMs), {
      generation: process.generation,
      processId: process.processId,
      taskId: process.taskId,
      token
    });
    const saved = await this.options.tasks.run(async () => {
      const current = this.active();
      if (
        !current ||
        current.processId !== process.processId ||
        current.taskId !== process.taskId ||
        current.generation !== process.generation ||
        current.pollToken !== process.pollToken
      )
        return null;
      return this.options.processStore.put({
        ...current,
        pollScheduleId: schedule.id,
        pollToken: token,
        updatedAt: new Date().toISOString()
      });
    });
    if (!saved) {
      await this.options.cancelSchedule(schedule.id).catch(() => false);
      throw new Error("The Bash process changed before its poll was saved");
    }
    if (process.pollScheduleId && process.pollScheduleId !== schedule.id) {
      await this.options.cancelSchedule(process.pollScheduleId).catch(() => false);
    }
    return saved;
  }

  private commandResult(process: ManagedLinuxProcess): LinuxCommandResult {
    if (!process.result) throw new Error("The Bash result is not available");
    return { ...process.result, type: "sandbox_command" };
  }

  private handoffResult(process: ManagedLinuxProcess): LinuxProcessHandoff {
    return {
      processId: process.processId,
      state:
        process.state === "uncertain"
          ? "uncertain"
          : ["cancelling", "cancelled"].includes(process.state)
            ? "cancelling"
            : "running",
      taskId: process.taskId,
      type: "sandbox_process"
    };
  }

  private async handoff(
    work: ActiveWork,
    predecessor: ActiveWork | null,
    process: ManagedLinuxProcess
  ): Promise<LinuxProcessResult> {
    const currentWork = this.options.tasks.current();
    if (
      currentWork?.taskId === work.taskId &&
      currentWork.generation === work.generation &&
      currentWork.state === "waiting"
    ) {
      await this.options.tasks.syncProjection(currentWork).catch(() => undefined);
    }
    if (predecessor?.scheduleId) {
      await this.options.cancelSchedule(predecessor.scheduleId).catch(() => false);
    }
    const latest = this.current();
    if (latest?.result && ["completed", "failed"].includes(latest.state)) {
      return this.commandResult(latest);
    }
    return this.handoffResult(latest ?? process);
  }

  private async finishInline(
    exitCode: number,
    process: ManagedLinuxProcess,
    work: ActiveWork,
    predecessor: ActiveWork | null
  ): Promise<LinuxProcessResult> {
    const finalizing = await this.options.tasks.run(async () => {
      const current = this.current();
      const currentWork = this.options.tasks.current();
      if (
        !current ||
        current.processId !== process.processId ||
        !["preparing", "running"].includes(current.state) ||
        !currentWork ||
        currentWork.taskId !== work.taskId ||
        currentWork.generation !== work.generation ||
        currentWork.state !== "waiting"
      )
        return null;
      return this.options.processStore.put({
        ...current,
        state: "finalizing",
        updatedAt: new Date().toISOString()
      });
    });
    if (!finalizing) return this.handoff(work, predecessor, process);

    let resultReady: ManagedLinuxProcess | null;
    try {
      resultReady = await this.captureProcessResult(exitCode, finalizing);
    } catch {
      return this.handoff(work, predecessor, finalizing);
    }
    if (!resultReady) return this.handoff(work, predecessor, finalizing);

    try {
      await this.sandboxCall(
        cleanupLinuxRun(this.runOptions(), resultReady.runRoot, resultReady.staged),
        "Sandbox process cleanup"
      );
    } catch {
      return this.handoff(work, predecessor, resultReady);
    }

    const completed = await this.options.tasks.run(async () =>
      this.options.transactionSync(() => {
        const current = this.current();
        const currentWork = this.options.tasks.current();
        if (
          !current ||
          current.processId !== resultReady.processId ||
          !current.result ||
          current.state !== "finalizing" ||
          !currentWork ||
          currentWork.taskId !== work.taskId ||
          currentWork.generation !== work.generation ||
          currentWork.state !== "waiting"
        )
          return null;
        if (!this.restoreInlineWork(currentWork, predecessor, "The Bash command finished")) {
          return null;
        }
        return this.options.processStore.put({
          ...current,
          state: current.result.exitCode === 0 ? "completed" : "failed",
          updatedAt: new Date().toISOString()
        });
      })
    );
    if (!completed) return this.handoff(work, predecessor, resultReady);
    if (completed.pollScheduleId) {
      await this.options.cancelSchedule(completed.pollScheduleId).catch(() => false);
    }
    return this.commandResult(completed);
  }

  private async waitForInlineExit(process: Process, waitMs: number): Promise<number | null> {
    let latest = process;
    const deadline = Date.now() + waitMs;
    let delayMs = INLINE_POLL_START_MS;
    while (isRunning(latest)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remaining)));
      const callTimeoutMs = Math.max(1, deadline - Date.now());
      if (callTimeoutMs <= 1) return null;
      try {
        const refreshed = await this.sandboxCall(
          this.options.computer().sandbox().getProcess(process.id),
          "Sandbox inline process lookup",
          callTimeoutMs
        );
        if (!refreshed) return null;
        latest = refreshed;
      } catch {
        return null;
      }
      delayMs = Math.min(delayMs * 2, INLINE_POLL_MAX_MS);
    }
    return latest.exitCode ?? (latest.status === "completed" ? 0 : 1);
  }

  private restoreInlineWork(
    expected: ActiveWork,
    predecessor: ActiveWork | null,
    checkpoint: string
  ): ActiveWork | null {
    const next: ActiveWork = predecessor
      ? { ...predecessor, updatedAt: new Date().toISOString() }
      : {
          ...expected,
          checkpoint,
          state: "done",
          generation: expected.generation + 1,
          updatedAt: new Date().toISOString()
        };
    return this.options.tasks.transition(expected, next);
  }
}
