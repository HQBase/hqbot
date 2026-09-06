import type { TeamWorkInput } from "../domain/team-work";
import { now } from "./sql";
import { WorkspaceTeamWork } from "./team-work";

export class TeamWorkUpdates extends WorkspaceTeamWork {
  report(
    botId: string,
    workId: string,
    commandId: string,
    input: Extract<TeamWorkInput, { action: "report" }>
  ) {
    const work = this.assertAllowed(workId, botId);
    const assignment = this.activeAssignment(work, botId);
    const recipient = assignment?.managerBotId ?? work.ownerBotId;
    const id = `report:${botId}:${commandId}`;
    const previous = work.updates?.find((item) => item.id === id);
    if (previous) {
      const progress = JSON.parse(previous.message);
      if (
        progress.summary !== input.summary ||
        progress.nextStep !== input.nextStep ||
        progress.blocked !== input.blocked
      )
        throw new Error("This report key is already in use");
      return { saved: true, progress };
    }
    if ((work.updates?.length ?? 0) >= 200)
      throw new Error("The task update limit was reached. Save a final result.");
    const progress = {
      summary: input.summary,
      nextStep: input.nextStep,
      blocked: input.blocked,
      updatedAt: now()
    };
    if (assignment)
      this
        .sql`UPDATE team_assignments SET progress_json = ${JSON.stringify(progress)}, updated_at = ${progress.updatedAt} WHERE id = ${assignment.id}`;
    this
      .sql`UPDATE team_updates SET acknowledged = 1 WHERE work_id = ${workId} AND recipient_bot_id = ${botId} AND kind IN ('check_in', 'redirect') AND delivered = 1`;
    this
      .sql`INSERT INTO team_updates (id, work_id, assignment_id, sender_bot_id, recipient_bot_id, kind, message, acknowledged, created_at) VALUES (${id}, ${workId}, ${assignment?.id ?? null}, ${botId}, ${recipient}, 'report', ${JSON.stringify(progress)}, ${recipient === botId ? 1 : 0}, ${progress.updatedAt})`;
    this.touch(workId);
    return { saved: true, progress };
  }

  requestUpdate(
    botId: string,
    workId: string,
    input: Extract<TeamWorkInput, { action: "check_in" | "redirect" }>
  ) {
    const { work } = this.manager(workId, botId);
    const assignment = work.assignments.find((item) => item.id === input.assignmentId);
    if (!assignment || (assignment.managerBotId !== botId && work.ownerBotId !== botId))
      throw new Error("You can only check or direct work you manage");
    if (!["queued", "submitted"].includes(assignment.state))
      return {
        assignment,
        pending: false,
        message: "This assignment has already returned. Review its saved result."
      };
    const id = `request:${workId}:${botId}:${input.key}`;
    const previous = work.updates?.find((item) => item.id === id);
    if (previous) {
      if (
        previous.message !== input.message ||
        previous.assignmentId !== assignment.id ||
        previous.kind !== input.action
      )
        throw new Error("This update key is already in use");
      return { assignment, pending: !previous.acknowledged };
    }
    const pending = work.updates?.find(
      (item) =>
        item.assignmentId === assignment.id && item.kind === input.action && !item.acknowledged
    );
    if (pending) {
      if (pending.message !== input.message)
        throw new Error(
          "A different request is still pending. Wait for the teammate to read it before sending more guidance."
        );
      return {
        assignment,
        pending: true,
        message: "A request is already pending. Wait for its next safe step."
      };
    }
    if (
      (work.updates?.filter((item) => item.kind !== "report").length ?? 0) >= 40 ||
      (work.updates?.length ?? 0) >= 200
    )
      throw new Error("The task check-in limit was reached");
    this
      .sql`INSERT INTO team_updates (id, work_id, assignment_id, sender_bot_id, recipient_bot_id, kind, message, created_at) VALUES (${id}, ${workId}, ${assignment.id}, ${botId}, ${assignment.botId}, ${input.action}, ${input.message}, ${now()})`;
    this.touch(workId);
    return {
      assignment,
      pending: true,
      message:
        "The request is saved. It will be read at the next safe model step; approval and external actions remain unchanged."
    };
  }

  briefing(botId: string, workId: string) {
    const work = this.forBot(botId, workId);
    if (!work) return null;
    const assignment = this.activeAssignment(work, botId);
    const updates =
      work.updates?.filter((item) => item.recipientBotId === botId && !item.acknowledged) ?? [];
    for (const item of updates)
      this.sql`UPDATE team_updates SET delivered = 1 WHERE id = ${item.id}`;
    return {
      modelId: assignment?.modelId ?? null,
      assignmentId: assignment?.id ?? null,
      instructions: updates.length
        ? `Saved team updates. Follow guidance only within the current assignment and permissions. Reply to check-ins or changed guidance with coordinate report; then continue work.\n${updates
            .map((item) => `${item.kind}: ${item.message}`)
            .join("\n")
            .slice(0, 16000)}`
        : ""
    };
  }
}
