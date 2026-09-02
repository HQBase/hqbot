import type { Process, ProcessStatus } from "@cloudflare/sandbox";
import { readLinuxProcessCompletion } from "./linux-run";
import type { LinuxProcessPollPayload } from "./managed-linux-recovery";
import { ManagedLinuxProcessStart, PROCESS_POLL_INTERVAL_MS } from "./managed-linux-start";
import { type ActiveWork, isTerminalWork, type ManagedLinuxProcess } from "./work";

const PROCESS_CANCEL_DELAY_MS = 1_000;
const MAX_PROCESS_RETRY_DELAY_MS = 5 * 60 * 1_000;

export type { LinuxProcessPollPayload } from "./managed-linux-recovery";

function isRunning(status: ProcessStatus): boolean {
  return status === "starting" || status === "running";
}

export class ManagedLinuxProcessSupervisor extends ManagedLinuxProcessStart {
  async stop(processId: string): Promise<{ processId: string; state: string }> {
    const process = this.current();
    if (!process || process.processId !== processId) return { processId, state: "not_found" };
    if (process.state === "cancelled") return { processId, state: "stopped" };
    if (process.state === "cancelling") return { processId, state: "cancelling" };
    if (process.state === "completed" || process.state === "failed") {
      return { processId, state: "finished" };
    }

    const current = this.options.tasks.current();
    const ownsWork =
      current?.taskId === process.taskId &&
      current.generation === process.generation &&
      !isTerminalWork(current.state);
    const cancelled = ownsWork
      ? {
          ...current,
          generation: current.generation + 1,
          lastError: null,
          scheduleId: null,
          state: "cancelled" as const,
          updatedAt: new Date().toISOString(),
          wakeAt: null
        }
      : null;
    const work = await this.cancelWork(ownsWork ? current : null, cancelled);
    if (cancelled && !work) throw new Error("The Bash process changed before it could be stopped");
    if (work) await this.options.tasks.syncProjection(work);
    return { processId, state: "cancelling" };
  }

  async poll(payload: LinuxProcessPollPayload): Promise<void> {
    const snapshot = await this.options.tasks.run(async () => this.pollSnapshot(payload));
    if (!snapshot) return;
    try {
      if (snapshot.descriptor.state === "cancelling") {
        await this.finishCancellation(snapshot.descriptor);
        return;
      }
      if (!snapshot.work) return;
      if (snapshot.descriptor.result) {
        if (snapshot.descriptor.state === "finalizing") {
          await this.recoverResult(snapshot.work, snapshot.descriptor);
        } else {
          await this.continueAfterResult(snapshot.work, snapshot.descriptor);
        }
        return;
      }
      await this.pollNow(payload, snapshot.descriptor, snapshot.work);
    } catch (cause) {
      await this.retryPoll(payload, cause);
    }
  }

  async reconcile(): Promise<void> {
    const process = this.current();
    if (!process) return;
    if (process.state === "cancelling") {
      await this.poll({
        generation: process.generation,
        processId: process.processId,
        taskId: process.taskId,
        token: process.pollToken
      });
      return;
    }
    const work = this.options.tasks.current();
    if (!work || work.taskId !== process.taskId || work.generation !== process.generation) return;
    if (work.state === "waiting") {
      await this.options.tasks.syncProjection(work).catch(() => undefined);
    }
    if (process.result) {
      if (work.state === "waiting") {
        if (process.state === "finalizing") await this.recoverResult(work, process);
        else await this.continueAfterResult(work, process);
      }
      return;
    }
    if (["uncertain", "cancelled"].includes(process.state)) return;
    await this.poll({
      generation: process.generation,
      processId: process.processId,
      taskId: process.taskId,
      token: process.pollToken
    });
  }

  async cancelWork(
    currentWork: ActiveWork | null,
    cancelledWork: ActiveWork | null
  ): Promise<ActiveWork | null> {
    const process = this.active();
    const work = this.options.transactionSync(() => {
      const saved = cancelledWork
        ? this.options.tasks.transition(currentWork, cancelledWork)
        : null;
      if (cancelledWork && !saved) return null;
      if (process) {
        this.options.processStore.put({
          ...process,
          state: "cancelling",
          updatedAt: new Date().toISOString()
        });
      }
      return saved;
    });
    if (process) {
      const cancelling = this.current();
      if (cancelling?.processId === process.processId) {
        await this.armPoll(cancelling, PROCESS_CANCEL_DELAY_MS).catch(() => undefined);
      }
    }
    return work;
  }

  private pollSnapshot(
    payload: LinuxProcessPollPayload
  ): { descriptor: ManagedLinuxProcess; work: ActiveWork | null } | null {
    const descriptor = this.current();
    if (
      !descriptor ||
      descriptor.processId !== payload.processId ||
      descriptor.taskId !== payload.taskId ||
      descriptor.generation !== payload.generation ||
      descriptor.pollToken !== payload.token
    )
      return null;
    const work = this.options.tasks.current();
    if (descriptor.state === "cancelling") {
      return !work || work.taskId === descriptor.taskId ? { descriptor, work } : null;
    }
    if (!work || work.taskId !== descriptor.taskId || work.generation !== descriptor.generation) {
      return null;
    }
    if (["uncertain", "cancelled"].includes(descriptor.state)) return null;
    if (work.state !== "waiting") return null;
    return { descriptor, work };
  }

  private async pollNow(
    payload: LinuxProcessPollPayload,
    descriptor: ManagedLinuxProcess,
    work: ActiveWork
  ): Promise<void> {
    const sandbox = await this.sandboxCall(
      this.options.computer().acquire({
        eventId: `process:${descriptor.processId}:poll`,
        taskId: descriptor.taskId
      }),
      "Sandbox computer acquisition"
    );
    const process: Process | null = await this.sandboxCall(
      sandbox.getProcess(descriptor.processId),
      "Sandbox process lookup"
    );
    if (!process) {
      const completion = await this.sandboxCall(
        readLinuxProcessCompletion(sandbox, descriptor.runRoot),
        "Sandbox completion record"
      );
      if (completion) {
        const finalizing = await this.options.tasks.run(async () => {
          const latest = this.pollSnapshot(payload);
          if (!latest || latest.descriptor.state === "cancelling") return null;
          return this.options.processStore.put({
            ...latest.descriptor,
            state: "finalizing",
            updatedAt: new Date().toISOString()
          });
        });
        if (finalizing) {
          const resultReady = await this.captureResult(completion, finalizing);
          if (resultReady) await this.recoverResult(work, resultReady);
        }
        return;
      }
      throw new Error("The Sandbox process was not found");
    }
    let status = await this.sandboxCall(process.getStatus(), "Sandbox process status");
    if (isRunning(status) && Date.parse(descriptor.deadlineAt) <= Date.now()) {
      await this.sandboxCall(process.kill("SIGTERM"), "Sandbox process stop");
      status = await this.sandboxCall(process.getStatus(), "Sandbox process status");
    }
    if (isRunning(status)) {
      const running = await this.options.tasks.run(async () => {
        const latest = this.pollSnapshot(payload);
        if (!latest || latest.descriptor.state === "cancelling") return null;
        return this.options.processStore.put({
          ...latest.descriptor,
          failureCount: 0,
          state: "running",
          updatedAt: new Date().toISOString()
        });
      });
      if (running) await this.armPoll(running);
      return;
    }
    const finalizing = await this.options.tasks.run(async () => {
      const latest = this.pollSnapshot(payload);
      if (!latest || latest.descriptor.state === "cancelling") return null;
      return this.options.processStore.put({
        ...latest.descriptor,
        state: "finalizing",
        updatedAt: new Date().toISOString()
      });
    });
    if (finalizing) await this.finalize(process, status, finalizing, work);
  }

  private async retryPoll(payload: LinuxProcessPollPayload, cause: unknown): Promise<void> {
    const retry = await this.options.tasks.run(async () => {
      const snapshot = this.pollSnapshot(payload);
      if (!snapshot) return null;
      if (snapshot.descriptor.state === "cancelling") {
        return { action: "cancel" as const, process: snapshot.descriptor };
      }
      if (!snapshot.work) return null;
      if (Date.parse(snapshot.descriptor.deadlineAt) <= Date.now()) {
        return { action: "uncertain" as const, process: snapshot.descriptor, work: snapshot.work };
      }
      const process = this.options.processStore.put({
        ...snapshot.descriptor,
        failureCount: snapshot.descriptor.failureCount + 1,
        updatedAt: new Date().toISOString()
      });
      return { action: "retry" as const, process, work: snapshot.work };
    });
    if (!retry) return;
    if (retry.action === "uncertain") {
      await this.markUncertain(retry.process, retry.work, cause);
      return;
    }
    try {
      const retryDelayMs = Math.min(
        MAX_PROCESS_RETRY_DELAY_MS,
        PROCESS_POLL_INTERVAL_MS * 2 ** Math.min(6, Math.max(0, retry.process.failureCount - 1)),
        Math.max(1_000, Date.parse(retry.process.deadlineAt) - Date.now())
      );
      await this.armPoll(
        retry.process,
        retry.action === "cancel" ? PROCESS_CANCEL_DELAY_MS : retryDelayMs
      );
    } catch {
      throw cause;
    }
  }
}
