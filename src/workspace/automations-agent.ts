import { getAgentByName } from "agents";
import type { AutomationInput, RoutineRun } from "../domain/automations";
import type { HQBotTeammate } from "../teammate";
import { WorkspaceRoutines } from "./routines";
import { WorkspaceTeamWorkAgent } from "./team-work-agent";

export class WorkspaceAutomationsAgent extends WorkspaceTeamWorkAgent {
  protected get routines() {
    return new WorkspaceRoutines(this.db);
  }
  override async onStart() {
    await super.onStart();
    if (this.routines.pending().length) await this.wakeRoutines();
  }
  protected wakeRoutines() {
    return this.schedule(
      1,
      "deliverRoutineRuns",
      {},
      { idempotent: true, retry: { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 10000 } }
    );
  }
  listAutomations(botId?: string) {
    return this.routines.list(botId);
  }
  override listRoutines(botId: string) {
    return this.routines.list(botId);
  }
  saveAutomation(input: AutomationInput) {
    const routine = this.ctx.storage.transactionSync(() => this.routines.save(input));
    this.changed();
    return routine;
  }
  override setRoutineActive(id: string, botId: string, active: boolean) {
    super.setRoutineActive(id, botId, active);
    if (!active)
      this
        .db`UPDATE routine_runs SET state = 'cancelled' WHERE routine_id = ${id} AND bot_id = ${botId} AND state = 'queued' AND source != 'manual'`;
    this
      .db`UPDATE routine_settings SET revision = revision + 1 WHERE routine_id = ${id} AND routine_id IN (SELECT id FROM routines WHERE bot_id = ${botId})`;
    return this.routines.list(botId).find((item) => item.id === id) ?? null;
  }
  async queueRoutineRun(
    botId: string,
    routineId: string,
    id: string,
    source: RoutineRun["source"],
    event?: string
  ) {
    await this.wakeRoutines();
    const run = this.ctx.storage.transactionSync(() =>
      this.routines.queue(botId, routineId, id, source, event)
    );
    this.changed();
    return run;
  }
  routineRunForBot(id: string, botId: string) {
    return this.routines.get(id, botId);
  }
  listRoutineRuns(botId: string, routineId: string) {
    return this.routines.history(botId, routineId);
  }
  finishRoutineRun(id: string, botId: string, result: string, failed = false) {
    this.routines.finish(id, botId, result, failed);
    this.changed();
  }
  protected override cancelBotDeliveries(botId: string) {
    super.cancelBotDeliveries(botId);
    this.routines.cancelBot(botId);
  }
  async deliverRoutineRuns() {
    for (const run of this.routines.pending()) {
      const bot = this.getBot(run.botId);
      if (!bot || bot.hidden) {
        this.routines.state(run.id, "cancelled");
        continue;
      }
      if (Date.now() - Date.parse(run.createdAt) > 7 * 86400000) {
        this.routines.finish(run.id, run.botId, "This queued run expired after seven days.", true);
        continue;
      }
      try {
        const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, run.botId);
        if (run.state === "queued")
          this.routines.state(
            run.id,
            (await peer.acceptRoutineRun(run.id)) ? "submitted" : "queued"
          );
        else {
          const status = await peer.routineRunStatus(run.id);
          if (status.result)
            this.routines.finish(run.id, run.botId, status.result.text, status.result.failed);
          else if (["aborted", "skipped", "error"].includes(status.status))
            this.routines.finish(
              run.id,
              run.botId,
              "The run stopped before a result was ready. Review the conversation.",
              true
            );
          else this.routines.state(run.id, "submitted");
        }
      } catch {
        this.routines.state(run.id, run.state);
      }
    }
    if (this.routines.pending().length)
      await this.schedule(10, "deliverRoutineRuns", {}, { idempotent: false });
    this.changed();
  }
  override getSnapshot(botId?: string) {
    const snapshot = super.getSnapshot(botId);
    const id = snapshot.selectedBot?.id;
    return id
      ? {
          ...snapshot,
          routines: this.listRoutines(id),
          files: this.listFiles(id),
          skills: this.listSkills(id)
        }
      : snapshot;
  }
}
