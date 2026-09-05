import type { ChatResponseResult } from "@cloudflare/think";
import { automationTools } from "./runtime/automation-tool";
import { teammateScheduledTasks } from "./runtime/schedules";
import { teammateResponseText } from "./runtime/turn";
import { TeammateCoordinationRuntime } from "./teammate-coordination";
import { activeDeliveryKey } from "./teammate-product";

const activeRunKey = "hqbot:active-routine-run";
const startedRunKey = "hqbot:started-routine-run";
interface RunResult {
  text: string;
  failed: boolean;
}
export abstract class TeammateAutomationsRuntime extends TeammateCoordinationRuntime {
  async getRoutineNextRun(id: string): Promise<string | null> {
    const schedules = await this.listSchedules();
    const match = schedules.find((schedule) => {
      const payload = schedule.payload;
      return (
        payload &&
        typeof payload === "object" &&
        "taskId" in payload &&
        payload.taskId === `routine_${id}`
      );
    });
    return match ? new Date(match.time * 1000).toISOString() : null;
  }
  async getScheduledTasks() {
    return teammateScheduledTasks(
      await this.workspaceAgent.listRoutines(this.name),
      () => this.computerRuntime.recoveryCheckpoint(),
      async (routine, context) => {
        await this.workspaceAgent.queueRoutineRun(
          this.name,
          routine.id,
          context.idempotencyKey,
          "schedule"
        );
      }
    );
  }

  protected override async canAct() {
    if (!(await super.canAct())) return false;
    const id = await this.ctx.storage.get<string>(activeRunKey);
    return !id || Boolean(await this.workspaceAgent.routineRunForBot(id, this.name));
  }
  protected override async otherInboundWork() {
    const id = await this.ctx.storage.get<string>(activeRunKey);
    if (id && !(await this.workspaceAgent.routineRunForBot(id, this.name))) {
      await this.ctx.storage.delete(activeRunKey);
      return super.otherInboundWork();
    }
    return Boolean(id) || super.otherInboundWork();
  }
  protected override productTools() {
    return {
      ...super.productTools(),
      ...automationTools(this.workspaceAgent, this.name, () =>
        this.internal_reconcileScheduledTasks()
      )
    };
  }
  acceptRoutineRun(id: string): Promise<boolean> {
    return this.admitProductWork(() => this.receiveRoutineRun(id));
  }
  private async receiveRoutineRun(id: string): Promise<boolean> {
    if (await this.inspectSubmission(`routine-run:${id}`)) return true;
    const run = await this.workspaceAgent.routineRunForBot(id, this.name);
    if (!run || !(await this.waitUntilStable({ timeout: 1 }))) return false;
    const current = await this.ctx.storage.get<string>(activeRunKey);
    if (await this.currentTeamWorkId()) return false;
    if (current && current !== id && (await this.otherInboundWork())) return false;
    const group = await this.ctx.storage.get<string>(activeDeliveryKey);
    if (group && (await this.workspaceAgent.deliveryForBot(group, this.name))) return false;
    if (
      this.tasks.active() ||
      this.processes.active() ||
      (await this.pendingApprovals()).length ||
      (await this.integrationRuntime.pending()).length
    )
      return false;
    const bot = await this.workspaceAgent.getBot(this.name);
    if (
      !bot ||
      bot.hidden ||
      !(await this.workspaceAgent.checkSpendPolicy(this.name, null)).allowed
    )
      return false;
    await this.ctx.storage.put(activeRunKey, id);
    await this.ctx.storage.delete(startedRunKey);
    const submissionId = `routine-run:${id}`;
    await this.submitMessages(
      [
        {
          id: submissionId,
          role: "user",
          parts: [
            {
              type: "text",
              text: `${run.prompt}\n\nGive a concise result and verify it. This run uses your current budget and permissions.`
            }
          ]
        }
      ],
      {
        channel: "web",
        idempotencyKey: submissionId,
        submissionId,
        metadata: { source: "routine", routineId: run.routineId, routineRunId: id }
      }
    );
    return true;
  }
  async routineRunStatus(id: string) {
    return {
      status: (await this.inspectSubmission(`routine-run:${id}`))?.status ?? "missing",
      result: (await this.ctx.storage.get<RunResult>(`hqbot:routine-result:${id}`)) ?? null
    };
  }
  protected override async assertProductTurnAllowed() {
    await super.assertProductTurnAllowed();
    const id = await this.ctx.storage.get<string>(activeRunKey);
    if (!id) return;
    if (this.activeTurnMetadata?.routineRunId === id) await this.ctx.storage.put(startedRunKey, id);
    if (!(await this.workspaceAgent.routineRunForBot(id, this.name))) {
      await this.ctx.storage.delete(activeRunKey);
      throw new Error("This routine run was stopped or deleted");
    }
  }
  protected override async productResponse(result: ChatResponseResult) {
    await super.productResponse(result);
    if (await this.currentTeamWorkId()) return;
    const id = await this.ctx.storage.get<string>(activeRunKey);
    if (
      !id ||
      (await this.ctx.storage.get<string>(startedRunKey)) !== id ||
      this.tasks.active() ||
      this.processes.active() ||
      (await this.pendingApprovals()).length ||
      (await this.integrationRuntime.pending()).length
    )
      return;
    const value = {
      text:
        teammateResponseText(result).slice(0, 12000) ||
        "The run ended without a text result. Review the conversation.",
      failed: result.status !== "completed"
    };
    await this.ctx.storage.put(`hqbot:routine-result:${id}`, value);
    await this.workspaceAgent.finishRoutineRun(id, this.name, value.text, value.failed);
    await this.ctx.storage.delete([activeRunKey, startedRunKey]);
  }
}
