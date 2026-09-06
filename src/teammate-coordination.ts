import type { ChatResponseResult } from "@cloudflare/think";
import { type ToolSet, tool } from "ai";
import { teamWorkInput } from "./domain/team-work";
import { savedTeamResult } from "./runtime/team-result";
import { teammateResponseText } from "./runtime/turn";
import { activeDeliveryKey, TeammateProductRuntime } from "./teammate-product";

const activeTeamKey = "hqbot:active-team-work";
interface ActiveTeam {
  workId: string;
  turnId?: string;
  assignmentId?: string;
  specialist: boolean;
  finished?: boolean;
  cancelled?: boolean;
  resultSubmissionId?: string;
}
interface TeamResult {
  text: string;
  failed: boolean;
}
export abstract class TeammateCoordinationRuntime extends TeammateProductRuntime {
  protected override async productContinuation(id: string) {
    await super.productContinuation(id);
    const active = await this.ctx.storage.get<ActiveTeam>(activeTeamKey);
    if (active && !active.finished && !active.cancelled)
      await this.ctx.storage.put(activeTeamKey, { ...active, resultSubmissionId: id });
  }
  protected override async currentTeamWorkId() {
    const active = await this.ctx.storage.get<ActiveTeam>(activeTeamKey);
    return active?.finished ? undefined : active?.workId;
  }
  protected override async otherInboundWork() {
    return Boolean(await this.ctx.storage.get(activeTeamKey)) || super.otherInboundWork();
  }
  protected override async canAct() {
    if (
      !(await super.canAct()) ||
      (await this.ctx.storage.get<ActiveTeam>(activeTeamKey))?.cancelled
    )
      return false;
    const id = await this.currentTeamWorkId();
    if (!id) return true;
    try {
      await this.workspaceAgent.assertTeamWorkAllowed(id, this.name);
      return true;
    } catch {
      return false;
    }
  }
  protected override async assertAgentToolAllowed(name: string, input: unknown) {
    await super.assertAgentToolAllowed(name, input);
    const active = await this.ctx.storage.get<ActiveTeam>(activeTeamKey);
    if (!active) return;
    if (active.cancelled) throw new Error("This team task was stopped");
    if (active.finished) throw new Error("The team task is finished. Give the final answer.");
    await this.workspaceAgent.assertTeamWorkAllowed(active.workId, this.name);
    if (
      ["collaborate", "schedule", "manage_automation"].includes(name) &&
      !(name === "collaborate" && (input as { action?: string })?.action !== "send")
    )
      throw new Error(
        "Team tasks use coordinate for handoffs and waiting. Do not start separate routines."
      );
    if (name === "manage_task" && !active.specialist)
      throw new Error("Use coordinate wait or finish for the team task you own.");
  }
  protected override productTools(): ToolSet {
    return {
      ...super.productTools(),
      coordinate: tool({
        description:
          "Coordinate one team task. Read settings for owner-controlled management, hiring, model and budget limits. Team lists available teammates. Start saves a goal and completion criteria. Assign bounded jobs using stable keys; approved managers can delegate smaller parts within the same task. Wait ends the turn and resumes you when results or reports arrive. Report milestones and blockers with the next step. Check_in requests progress; redirect sends changed guidance at the next safe step. Review your direct reports and their evidence before finish, with a check for each criterion (criterion 0 for a delegated manager). One root budget, deadline and cancellation cover all work. Hire creates a teammate only when the owner has enabled it. Private permissions, memory, files, connections and computers stay separate.",
        inputSchema: teamWorkInput,
        execute: async (input, context) => {
          const active = await this.ctx.storage.get<ActiveTeam>(activeTeamKey);
          const deliveryId = await this.ctx.storage.get<string>(activeDeliveryKey);
          const delivery = deliveryId
            ? await this.workspaceAgent.deliveryForBot(deliveryId, this.name)
            : null;
          if (
            input.action === "start" &&
            active &&
            active.workId !== `team:${this.name}:${context.toolCallId}`
          )
            throw new Error("Finish or stop the current team task first");
          if (input.action === "start")
            await this.ctx.storage.put(activeTeamKey, {
              workId: `team:${this.name}:${context.toolCallId}`,
              specialist: false
            });
          let result: unknown;
          try {
            result = await this.workspaceAgent.coordinate(
              this.name,
              input,
              active?.workId,
              context.toolCallId,
              delivery?.requesterId ?? (await this.collaborationRequester())
            );
          } catch (cause) {
            if (
              input.action === "start" &&
              !(await this.workspaceAgent.teamWorkForBot(
                this.name,
                `team:${this.name}:${context.toolCallId}`
              ))
            )
              await this.ctx.storage.delete(activeTeamKey);
            throw cause;
          }
          if (input.action === "start")
            await this.ctx.storage.put(activeTeamKey, {
              workId: (result as { id: string }).id,
              specialist: false
            });
          if (input.action === "finish" && active)
            await this.ctx.storage.put(activeTeamKey, { ...active, finished: true });
          return result;
        }
      })
    };
  }
  async acceptTeamWork(id: string): Promise<boolean> {
    return this.admitProductWork(async () => {
      if (await this.inspectSubmission(`team-work:${id}`)) return true;
      const turn = await this.workspaceAgent.teamTurnForBot(id, this.name);
      if (!turn || !(await this.waitUntilStable({ timeout: 1 }))) return false;
      const active = await this.ctx.storage.get<ActiveTeam>(activeTeamKey);
      if (
        active &&
        (active.cancelled ||
          active.workId !== turn.workId ||
          (active.assignmentId && active.assignmentId !== turn.assignmentId))
      )
        return false;
      if (
        active?.specialist &&
        active.turnId &&
        active.turnId !== id &&
        !(await this.ctx.storage.get(`hqbot:team-result:${active.turnId}`))
      )
        return false;
      if (
        !active &&
        ((await this.otherInboundWork()) || (await this.ctx.storage.get(activeDeliveryKey)))
      )
        return false;
      if (
        this.tasks.active() ||
        this.processes.active() ||
        (await this.pendingApprovals()).length ||
        (await this.integrationRuntime.pending()).length
      )
        return false;
      if (!(await this.workspaceAgent.checkSpendPolicy(this.name, null)).allowed) return false;
      await this.ctx.storage.put(activeTeamKey, {
        workId: turn.workId,
        turnId: id,
        assignmentId: turn.assignmentId ?? undefined,
        specialist: Boolean(turn.assignmentId)
      });
      const submissionId = `team-work:${id}`;
      await this.submitMessages(
        [{ id: submissionId, role: "user", parts: [{ type: "text", text: turn.prompt }] }],
        {
          channel: "web",
          idempotencyKey: submissionId,
          submissionId,
          metadata: { source: "team-work", teamTurnId: id }
        }
      );
      return true;
    });
  }
  async stopTeamWork(workId: string) {
    const active = await this.ctx.storage.get<ActiveTeam>(activeTeamKey);
    if (!active || active.workId !== workId) return;
    await this.ctx.storage.put(activeTeamKey, { ...active, cancelled: true });
    const reason = "This team task was stopped or reached a limit";
    await this.tasks.cancel(reason);
    for (const submission of await this.listSubmissions({ status: ["running"] }))
      await this.cancelSubmission(submission.submissionId, reason);
    await this.integrationRuntime.rejectAll();
    for (const approval of await this.pendingApprovals())
      await this.rejectExecution(approval.executionId);
    if (!(await this.waitUntilStable({ timeout: 1 })))
      throw new Error("Waiting for the stopped turn to settle");
    await this.ctx.storage.delete(activeTeamKey);
    await this.workspaceAgent.markInteraction(this.name, reason, "idle");
  }
  async teamOwnerIsIdle(workId: string) {
    const work = await this.workspaceAgent.teamWorkForBot(this.name, workId);
    if (!work || work.ownerBotId !== this.name || !["active", "waiting"].includes(work.state))
      return false;
    return (
      !(
        this.tasks.active() ||
        this.processes.active() ||
        (await this.pendingApprovals()).length ||
        (await this.integrationRuntime.pending()).length
      ) && (await this.waitUntilStable({ timeout: 1 }))
    );
  }
  async teamWorkStatus(id: string) {
    const active = await this.ctx.storage.get<ActiveTeam>(activeTeamKey);
    const submissionId = (active?.turnId === id && active.resultSubmissionId) || `team-work:${id}`;
    const submission = await this.inspectSubmission(submissionId);
    let result = (await this.ctx.storage.get<TeamResult>(`hqbot:team-result:${id}`)) ?? null;
    if (
      !result &&
      submission?.status === "completed" &&
      active?.turnId === id &&
      !active.cancelled &&
      Date.now() - (submission.completedAt ?? Date.now()) > 30000 &&
      !this.tasks.active() &&
      !this.processes.active() &&
      !this.integrationRuntime.hasPendingContinuation() &&
      !(await this.pendingApprovals()).length &&
      !(await this.integrationRuntime.pending()).length &&
      (await this.waitUntilStable({ timeout: 1 }))
    ) {
      const current = await this.ctx.storage.get<ActiveTeam>(activeTeamKey);
      if (current?.resultSubmissionId !== active.resultSubmissionId || current?.cancelled)
        return { status: "running", result: null };
      const text = savedTeamResult(this.messages, submissionId);
      result = {
        text:
          text ??
          "The completed turn has no verifiable saved answer. Review the conversation before retrying this assignment.",
        failed: !text
      };
      await this.ctx.storage.put(`hqbot:team-result:${id}`, result);
      await this.workspaceAgent.finishTeamTurn(id, this.name, result.text, result.failed);
      const work = await this.workspaceAgent.teamWorkForBot(this.name, active.workId);
      if (
        !result.failed &&
        work &&
        ["active", "waiting"].includes(work.state) &&
        (!active.specialist ||
          work.assignments.some(
            (item) => item.id === active.assignmentId && item.state === "submitted"
          ))
      )
        await this.ctx.storage.put(activeTeamKey, { ...active, turnId: undefined });
      else await this.ctx.storage.delete(activeTeamKey);
    }
    return { status: submission?.status ?? "missing", result };
  }

  protected override async assertProductTurnAllowed() {
    await super.assertProductTurnAllowed();
    const active = await this.ctx.storage.get<ActiveTeam>(activeTeamKey);
    if (!active || active.finished) return;
    if (active.cancelled) throw new Error("This team task was stopped");
    try {
      await this.workspaceAgent.assertTeamWorkAllowed(active.workId, this.name);
    } catch (cause) {
      await this.ctx.storage.put(activeTeamKey, { ...active, cancelled: true });
      throw cause;
    }
  }
  protected override async productResponse(result: ChatResponseResult) {
    const active = await this.ctx.storage.get<ActiveTeam>(activeTeamKey);
    if (!active) return super.productResponse(result);
    if (active.cancelled) return;
    if (
      this.tasks.active() ||
      this.processes.active() ||
      this.integrationRuntime.hasPendingContinuation() ||
      (active.resultSubmissionId &&
        this.activeTurnMetadata?.integrationResultId !== active.resultSubmissionId) ||
      (await this.pendingApprovals()).length ||
      (await this.integrationRuntime.pending()).length
    )
      return;
    const value = {
      text: teammateResponseText(result).slice(0, 12000) || "The turn ended without a text result.",
      failed: result.status !== "completed"
    };
    if (active.turnId) {
      await this.ctx.storage.put(`hqbot:team-result:${active.turnId}`, value);
      await this.workspaceAgent.finishTeamTurn(active.turnId, this.name, value.text, value.failed);
    }
    if (!active.specialist && !active.finished) {
      await this.ctx.storage.put(activeTeamKey, { workId: active.workId, specialist: false });
      if (!active.turnId)
        await this.workspaceAgent.finishTeamOwnerTurn(active.workId, this.name, value.failed);
      const work = await this.workspaceAgent.teamWorkForBot(this.name, active.workId);
      if (work && ["active", "waiting"].includes(work.state)) {
        await this.workspaceAgent.markInteraction(this.name, "Waiting for team results", "working");
        return;
      }
    }
    if (active.specialist && !active.finished && !value.failed) {
      const work = await this.workspaceAgent.teamWorkForBot(this.name, active.workId);
      if (
        work?.assignments.some(
          (item) => item.id === active.assignmentId && item.state === "submitted"
        )
      ) {
        await this.ctx.storage.put(activeTeamKey, {
          workId: active.workId,
          assignmentId: active.assignmentId,
          specialist: true
        });
        await this.workspaceAgent.markInteraction(this.name, "Waiting for team results", "working");
        return;
      }
    }
    await this.ctx.storage.delete(activeTeamKey);
    await super.productResponse(result);
  }
}
