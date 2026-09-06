import type { ChatResponseResult } from "@cloudflare/think";
import { resumeOwnerTask } from "./runtime/owner-task-resume";
import { checkTaskWatchdog, type TaskHeartbeat } from "./runtime/task-watchdog";
import { finishTeammateResponse, teammateResponseText } from "./runtime/turn";
import { TeammateLocalRuntime } from "./teammate-local";

const scheduleKey = "hqbot:task-watchdog:v1";
const heartbeatKey = "hqbot:task-heartbeat:v1";
export abstract class TeammateRecoveryRuntime extends TeammateLocalRuntime {
  private progressAt = 0;
  protected async recordTaskProgress() {
    const work = this.tasks.active();
    if (!work || Date.now() - this.progressAt < 10_000) return;
    this.progressAt = Date.now();
    await this.ctx.storage.put<TaskHeartbeat>(heartbeatKey, {
      taskId: work.taskId,
      generation: work.generation,
      at: this.progressAt
    });
  }
  async onChunk() {
    await this.recordTaskProgress();
  }
  protected async armTaskWatchdog() {
    const schedule = await this.scheduleEvery(
      60,
      "recoverRuntime",
      {},
      {
        retry: { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 10000 }
      }
    );
    await this.ctx.storage.put(scheduleKey, schedule.id);
  }

  private async recoveryBlocked() {
    return (
      !(await this.canAct()) ||
      Boolean(this.processes.active()) ||
      Boolean(this.ownerHandoffs.pending()) ||
      (await this.integrationRuntime.pending()).length > 0 ||
      (await this.listComputerApprovals()).length > 0
    );
  }
  protected resumeOwnerTask() {
    return resumeOwnerTask(this.tasks, this.activeTurnMetadata, () => this.recoveryBlocked());
  }
  async recoverRuntime(): Promise<void> {
    // Arm first so an interrupted check cannot remove recovery for an active task.
    if (this.tasks.active()) await this.armTaskWatchdog();
    else {
      const id = await this.ctx.storage.get<string>(scheduleKey);
      if (id) await this.cancelSchedule(id);
      await this.ctx.storage.delete(scheduleKey);
    }
    await this.computerRuntime.reconcileOwnerControl();
    await this.processes.reconcile();
    await this.ownerHandoffs.recover();
    await this.integrationRuntime.recover();
    await this.resumeOwnerTask();
    await checkTaskWatchdog({
      tasks: this.tasks,
      blocked: () => this.recoveryBlocked(),
      stable: () => this.waitUntilStable({ timeout: 1000 }),
      submissionPending: async (work) => {
        const submission = work.submissionId
          ? await this.inspectSubmission(work.submissionId)
          : null;
        return submission?.status === "pending" || submission?.status === "running";
      },
      heartbeat: () => this.ctx.storage.get<TaskHeartbeat>(heartbeatKey),
      unresolvedEffect: () =>
        this
          .sql`SELECT effect_key FROM hqbot_external_effect_receipts WHERE state = 'uncertain' LIMIT 1`
          .length > 0,
      retry: (id) => this.taskSupervision.retryDelay(id, "Task continuation timeout") !== null,
      abort: async (work) => {
        this.cancelAllChats();
        if (work.submissionId)
          await this.cancelSubmission(work.submissionId, "Task continuation timeout");
      },
      now: () => Date.now()
    });
    const work = this.tasks.active();
    if (work?.state === "waiting" && !this.processes.active())
      await this.tasks.run(() => this.tasks.reconcile());
  }
  async getTaskHealth() {
    const work = this.tasks.current();
    const scheduleId = await this.ctx.storage.get<string>(scheduleKey);
    return {
      work: work
        ? {
            taskId: work.taskId,
            generation: work.generation,
            state: work.state,
            submissionId: work.submissionId,
            updatedAt: work.updatedAt
          }
        : null,
      stable: await this.waitUntilStable({ timeout: 10 }),
      pendingInteraction: this.hasPendingInteraction(),
      processActive: Boolean(this.processes.active()),
      handoffPending: Boolean(this.ownerHandoffs.pending()),
      approvalCount: (await this.pendingApprovals()).length,
      heartbeat: await this.ctx.storage.get<TaskHeartbeat>(heartbeatKey),
      watchdogScheduled: Boolean(scheduleId && (await this.getScheduleById(scheduleId))),
      alarmAt: await this.ctx.storage.getAlarm(),
      schedules: this
        .sql`SELECT id, callback, type, time, running, execution_started_at FROM cf_agents_schedules ORDER BY time LIMIT 12`,
      unresolvedEffects: this
        .sql`SELECT effect_key FROM hqbot_external_effect_receipts WHERE state = 'uncertain'`
        .length,
      submissions: (await this.listSubmissions({ limit: 5 })).map((s) => ({
        id: s.submissionId,
        status: s.status,
        createdAt: s.createdAt,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        hasError: Boolean(s.error),
        taskId: s.metadata?.taskId,
        generation: s.metadata?.generation
      })),
      incompleteTools: this.messages
        .flatMap((m) =>
          m.parts.flatMap((p) => {
            const part = p as { type: string; state?: string; toolCallId?: string };
            return part.state &&
              [
                "input-streaming",
                "input-available",
                "approval-requested",
                "approval-responded"
              ].includes(part.state)
              ? [
                  {
                    messageId: m.id,
                    type: part.type,
                    state: part.state,
                    toolCallId: part.toolCallId
                  }
                ]
              : [];
          })
        )
        .slice(-20)
    };
  }
  async onChatResponse(result: ChatResponseResult): Promise<void> {
    const pending = [
      ...(await this.integrationRuntime.pending()),
      ...(await this.listComputerApprovals())
    ];
    const work = this.tasks.active();
    if (
      (pending.length || this.ownerHandoffs.pending()) &&
      work?.state === "running" &&
      !this.processes.active()
    )
      await this.tasks.manage({
        action: "needs_user",
        goal: work.goal,
        checkpoint: `${work.checkpoint}\nWaiting for owner approval of the connected action.`
      });
    await this.tasks.run(() =>
      this.tasks.settleTurn(
        this.activeTurnMetadata?.taskId,
        this.activeTurnMetadata?.generation,
        result.status,
        teammateResponseText(result),
        result.error
      )
    );
    const activeWork = this.tasks.active();
    await finishTeammateResponse({
      botId: this.name,
      interactionStatus:
        activeWork?.state === "running" || this.processes.active() ? "working" : "idle",
      result,
      workspaceAgent: this.workspaceAgent
    });
    if (pending.length > 0) {
      await this.workspaceAgent.markInteraction(
        this.name,
        "Action needs approval",
        "needs_approval"
      );
    }
    await this.productResponse(result);
    await this.computerRuntime.recoveryCheckpoint().catch(() => undefined);
  }
}
