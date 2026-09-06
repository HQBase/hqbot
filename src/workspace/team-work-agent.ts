import { getAgentByName } from "agents";
import type { CollaborationRequest } from "../domain/projects";
import type { TeamPolicy } from "../domain/team-policy";
import { type TeamWorkInput, teamWorkInput } from "../domain/team-work";
import type { HQBotTeammate } from "../teammate";
import { positiveNumber } from "./budgets";
import { ensureChief } from "./chief";
import { WorkspaceProjectsAgent } from "./projects-agent";
import { WorkspaceTeam } from "./team";
import { WorkspaceTeamPolicy } from "./team-policy";
import { TeamWorkDelivery } from "./team-work-delivery";

export class WorkspaceTeamWorkAgent extends WorkspaceProjectsAgent {
  getTeamPolicy(botId: string) {
    return new WorkspaceTeamPolicy(this.db).get(botId);
  }
  saveTeamPolicy(botId: string, value: TeamPolicy) {
    const policy = this.ctx.storage.transactionSync(() =>
      new WorkspaceTeamPolicy(this.db).save(botId, value)
    );
    this.changed();
    return policy;
  }
  teamBriefing(botId: string, workId: string) {
    return this.ctx.storage.transactionSync(() => this.teamWork.briefing(botId, workId));
  }
  protected get teamWork() {
    return new TeamWorkDelivery(this.db);
  }
  override async onStart() {
    await super.onStart();
    if (this.teamWork.active().length || this.teamWork.cancellations().length)
      await this.wakeTeamWork();
  }
  override getSnapshot(botId?: string) {
    if (this.hasOwner())
      this.ctx.storage.transactionSync(() =>
        ensureChief(
          this.db,
          this.env.HQBOT_MODEL_ID,
          positiveNumber(this.env.HQBOT_BOT_DAILY_BUDGET_USD, 2)
        )
      );
    return super.getSnapshot(botId);
  }
  private wakeTeamWork() {
    return this.schedule(
      1,
      "deliverTeamWork",
      {},
      { idempotent: true, retry: { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 10000 } }
    );
  }
  async coordinate(
    botId: string,
    value: TeamWorkInput,
    workId: string | undefined,
    commandId: string,
    requesterId?: string
  ) {
    const input = teamWorkInput.parse(value);
    if (input.action === "team")
      return this.listBots()
        .filter(
          (bot) => !requesterId || new WorkspaceTeam(this.db).canBot(requesterId, bot.id, true)
        )
        .map((bot) => ({
          id: bot.id,
          name: bot.name,
          title: bot.title,
          status: bot.status,
          role: bot.coordinationRole,
          modelId: bot.modelId,
          canManage: this.getTeamPolicy(bot.id).canManage
        }));
    if (input.action === "status") return this.teamWork.forBot(botId, input.workId ?? workId);
    if (input.action === "settings") return this.getTeamPolicy(botId);
    await this.wakeTeamWork();
    const result = this.ctx.storage.transactionSync(() => {
      if (input.action === "hire") {
        if (
          requesterId ||
          (workId &&
            this.db`SELECT id FROM team_work WHERE id = ${workId} AND requester_id IS NOT NULL`
              .length)
        )
          throw new Error("Only an owner conversation can create teammates");
        return new WorkspaceTeamPolicy(this.db).hire(botId, input);
      }
      if (input.action === "start")
        return this.teamWork.start(
          botId,
          `team:${botId}:${commandId}`,
          input,
          positiveNumber(this.env.HQBOT_TASK_BUDGET_USD, 1),
          requesterId
        );
      if (!workId) throw new Error("Start a team task first");
      if (input.action === "peers") return this.teamWork.peers(botId, workId);
      if (input.action === "ask") return this.teamWork.ask(botId, workId, input);
      if (input.action === "answer") return this.teamWork.answer(botId, workId, input);
      if (input.action === "report") return this.teamWork.report(botId, workId, commandId, input);
      if (input.action === "check_in" || input.action === "redirect")
        return this.teamWork.requestUpdate(botId, workId, input);
      if (input.action === "assign") return this.teamWork.assign(botId, workId, input);
      if (input.action === "review") return this.teamWork.review(botId, workId, input);
      if (input.action === "wait") return this.teamWork.wait(botId, workId);
      if (input.action === "finish") return this.teamWork.finish(botId, workId, input);
      throw new Error("Unknown team action");
    });
    this.changed();
    return result;
  }
  teamWorkForBot(botId: string, workId?: string) {
    return this.teamWork.forBot(botId, workId);
  }
  teamTurnForBot(id: string, botId: string) {
    return this.teamWork.turn(id, botId);
  }
  assertTeamWorkAllowed(id: string, botId: string): void {
    this.teamWork.assertAllowed(id, botId);
  }
  async finishTeamTurn(id: string, botId: string, result: string, failed: boolean) {
    await this.wakeTeamWork();
    this.ctx.storage.transactionSync(() => this.teamWork.finishTurn(id, botId, result, failed));
    this.changed();
  }
  async finishTeamOwnerTurn(id: string, botId: string, failed: boolean, token = "start") {
    await this.wakeTeamWork();
    this.ctx.storage.transactionSync(() => this.teamWork.ownerReturned(id, botId, failed, token));
    this.changed();
  }
  protected override cancelBotDeliveries(botId: string) {
    super.cancelBotDeliveries(botId);
    this.teamWork.cancelBot(botId);
  }
  override deleteProject(id: string) {
    for (const work of this.teamWork.active())
      if (this.teamWork.get(work.id)?.projectId === id)
        this.teamWork.stop(work.id, "The group was deleted");
    return super.deleteProject(id);
  }
  override async sendCollaboration(sender: string | null, input: CollaborationRequest) {
    if (sender)
      throw new Error(
        "Use coordinate to assign a bounded task through Chief of Staff or the group lead. Use collaborate to read shared context."
      );
    const project = this.projects.assertMember(input.projectId);
    if (input.recipientIds.length !== 1 || input.recipientIds[0] !== project.leadBotId)
      throw new Error(
        "Send the group request to its lead. The lead assigns work and returns one answer."
      );
    return super.sendCollaboration(sender, input);
  }
  async deliverTeamWork() {
    for (const work of this.teamWork.active()) {
      try {
        this.teamWork.assertAllowed(work.id, work.owner_bot_id);
      } catch (cause) {
        this.teamWork.stop(
          work.id,
          cause instanceof Error ? cause.message : "The team task cannot continue",
          "failed"
        );
      }
      if (this.teamWork.needsOwnerRecovery(work.id)) {
        try {
          const peer = await getAgentByName<Env, HQBotTeammate>(
            this.env.HQBOT_TEAMMATE,
            work.owner_bot_id
          );
          if (await peer.teamOwnerIsIdle(work.id))
            this.ctx.storage.transactionSync(() =>
              this.teamWork.ownerReturned(
                work.id,
                work.owner_bot_id,
                false,
                this.teamWork.ownerToken(work.id)
              )
            );
        } catch {
          /* Retry an idle owner check on the next wake. */
        }
      }
      this.ctx.storage.transactionSync(() => {
        this.teamWork.queueQuestionTurns(work.id);
        this.teamWork.queueManagers(work.id);
        this.teamWork.queueOwner(work.id);
      });
    }
    for (const row of this.teamWork.cancellations()) {
      try {
        const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, row.bot_id);
        await peer.stopTeamWork(row.work_id);
        this.teamWork.cancelled(row.work_id, row.bot_id);
      } catch {
        /* Retry the scoped stop after a transient runtime failure. */
      }
    }
    for (const row of this.teamWork.pending()) {
      const turn = this.teamWork.turn(row.id, row.bot_id);
      if (!turn) {
        this
          .db`INSERT OR IGNORE INTO team_cancellations (work_id, bot_id) SELECT work_id, bot_id FROM team_turns WHERE id = ${row.id}`;
        this.teamWork.finishTurn(
          row.id,
          row.bot_id,
          "The assignment lost access or reached a limit",
          true
        );
        continue;
      }
      try {
        const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, row.bot_id);
        if (row.state === "pending") {
          if (await peer.acceptTeamWork(row.id)) this.teamWork.submitted(row.id);
        } else {
          const status = await peer.teamWorkStatus(row.id);
          if (status.result)
            this.teamWork.finishTurn(row.id, row.bot_id, status.result.text, status.result.failed);
          else if (["aborted", "skipped", "error"].includes(status.status))
            this.teamWork.finishTurn(
              row.id,
              row.bot_id,
              "The specialist turn stopped before returning a result",
              true
            );
        }
      } catch {
        /* Keep the durable delivery pending. Retry with the same submission ID. */
      }
    }
    if (this.teamWork.active().length || this.teamWork.cancellations().length)
      await this.schedule(10, "deliverTeamWork", {}, { idempotent: false });
    this.changed();
  }
}
