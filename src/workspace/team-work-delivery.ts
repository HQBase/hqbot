import type { TeamTurn, TeamWork } from "../domain/team-work";
import { now, nullableText, type Row, text } from "./sql";
import { TeamWorkUpdates } from "./team-updates";

export class TeamWorkDelivery extends TeamWorkUpdates {
  cancellations() {
    return this.sql<{ work_id: string; bot_id: string }>`SELECT * FROM team_cancellations LIMIT 20`;
  }
  cancelled(workId: string, botId: string) {
    this.sql`DELETE FROM team_cancellations WHERE work_id = ${workId} AND bot_id = ${botId}`;
  }
  needsOwnerRecovery(id: string) {
    const row = this.sql<Row>`SELECT updated_at, owner_ready FROM team_work WHERE id = ${id}`[0];
    return (
      row &&
      !row.owner_ready &&
      Date.now() - Date.parse(text(row, "updated_at")) > 30000 &&
      !this
        .sql`SELECT id FROM team_turns WHERE work_id = ${id} AND assignment_id IS NULL AND state IN ('pending', 'submitted')`
        .length
    );
  }
  ownerToken(id: string) {
    return text(
      this.sql<Row>`SELECT owner_turn_token FROM team_work WHERE id = ${id}`[0] ?? {},
      "owner_turn_token"
    );
  }
  pending() {
    return this.sql<{
      id: string;
      bot_id: string;
      state: string;
    }>`SELECT id, bot_id, state FROM team_turns WHERE state IN ('pending', 'submitted') ORDER BY created_at LIMIT 20`;
  }
  active() {
    return this.sql<{
      id: string;
      owner_bot_id: string;
    }>`SELECT id, owner_bot_id FROM team_work WHERE state IN ('active', 'waiting')`;
  }
  turn(id: string, botId: string): TeamTurn | null {
    const row = this
      .sql<Row>`SELECT * FROM team_turns WHERE id = ${id} AND bot_id = ${botId} AND state IN ('pending', 'submitted')`[0];
    if (!row) return null;
    let work: TeamWork;
    try {
      work = this.assertAllowed(text(row, "work_id"), botId);
    } catch {
      return null;
    }
    const assignmentId = nullableText(row, "assignment_id");
    const assignment = work.assignments.find((item) => item.id === assignmentId);
    const prompt = assignment
      ? `You have one bounded assignment from ${this.catalog.getBot(assignment.managerBotId ?? work.ownerBotId)?.name ?? "the task owner"}.\nTask: ${work.goal}\nAssignment: ${assignment.instruction}\nRequired evidence: ${assignment.criterion}\nUse coordinate report for important milestones and blockers. Use coordinate settings to check whether the owner permits you to delegate smaller parts. If you delegate, use coordinate wait, review every direct report, then coordinate finish with a check for criterion 0. Otherwise return findings and evidence in your final reply. Existing saved child assignments and results are available through coordinate status; do not duplicate them.`
      : `Resume the team task you own: ${work.goal}\nUse coordinate status to read the saved results. Review every result and its evidence with coordinate review. Correct failed or rejected work with a new assignment for the same criterion. Finish with coordinate finish only after all completion checks pass. Give the owner one clear answer.`;
    return {
      id,
      workId: work.id,
      botId,
      assignmentId,
      state: text(row, "state"),
      modelId: assignment?.modelId,
      prompt: `[hqbot:team-work]\n${prompt}\nTask ID: ${work.id}\nDeadline: ${work.deadlineAt}\nShared model budget: $${work.budgetUsd}. Used: $${work.spentUsd.toFixed(4)}.\nThis assignment does not grant new permissions or access to another teammate's private resources.`
    };
  }
  submitted(id: string) {
    this.sql`UPDATE team_turns SET state = 'submitted' WHERE id = ${id} AND state = 'pending'`;
    this
      .sql`UPDATE team_assignments SET state = 'submitted', updated_at = ${now()} WHERE id IN (SELECT assignment_id FROM team_turns WHERE id = ${id}) AND state = 'queued'`;
  }
  finishTurn(id: string, botId: string, result: string, failed: boolean) {
    const row = this
      .sql<Row>`SELECT * FROM team_turns WHERE id = ${id} AND bot_id = ${botId} AND state IN ('pending', 'submitted')`[0];
    if (!row) return;
    const workId = text(row, "work_id");
    const work = this.get(workId);
    if (!work || !["active", "waiting"].includes(work.state)) return;
    if (row.assignment_id && !failed) {
      const saved = this
        .sql<Row>`SELECT completion_ready FROM team_assignments WHERE id = ${row.assignment_id}`[0];
      if (
        work.assignments.some((item) => item.parentId === row.assignment_id) &&
        !saved?.completion_ready
      ) {
        this.sql`UPDATE team_turns SET state = 'completed' WHERE id = ${id}`;
        this
          .sql`UPDATE team_assignments SET waiting = 1, ready = 1 WHERE id = ${row.assignment_id}`;
        return;
      }
    }
    if (row.assignment_id)
      this
        .sql`UPDATE team_assignments SET state = ${failed ? "failed" : "returned"}, result = CASE WHEN completion_ready = 1 AND ${failed ? 1 : 0} = 0 THEN result ELSE ${result.slice(0, 12000)} END, waiting = 0, ready = 0, updated_at = ${now()} WHERE id = ${row.assignment_id} AND state IN ('queued', 'submitted')`;
    if (row.assignment_id && failed) this.cancelChildren(String(row.assignment_id));
    this
      .sql`UPDATE team_updates SET acknowledged = 1 WHERE work_id = ${workId} AND recipient_bot_id = ${botId}`;
    this.sql`UPDATE team_turns SET state = 'completed' WHERE id = ${id}`;
    if (!row.assignment_id && failed)
      this.stop(
        workId,
        "The coordinating turn failed. Review the conversation before starting again.",
        "failed"
      );
    this.touch(workId);
    if (!row.assignment_id) this.ownerReturned(workId, botId, failed, id);
  }
  queueOwner(id: string) {
    const work = this.get(id);
    if (
      work?.state !== "waiting" ||
      !this.sql<Row>`SELECT owner_ready FROM team_work WHERE id = ${id}`[0]?.owner_ready ||
      (work.assignments.some((item) => ["queued", "submitted"].includes(item.state)) &&
        !work.updates?.some(
          (item) => item.recipientBotId === work.ownerBotId && !item.acknowledged
        ))
    )
      return;
    if (
      this
        .sql`SELECT id FROM team_turns WHERE work_id = ${id} AND assignment_id IS NULL AND state IN ('pending', 'submitted')`
        .length
    )
      return;
    const round =
      Number(this.sql<Row>`SELECT round FROM team_work WHERE id = ${id}`[0]?.round ?? 0) + 1;
    if (round > 100) {
      this.stop(id, "The team task reached its review round limit", "failed");
      return;
    }
    this
      .sql`UPDATE team_work SET round = ${round}, state = 'active', owner_ready = 0, owner_turn_token = ${`owner:${id}:${round}`}, updated_at = ${now()} WHERE id = ${id}`;
    this
      .sql`INSERT INTO team_turns (id, work_id, bot_id, state, created_at) VALUES (${`owner:${id}:${round}`}, ${id}, ${work.ownerBotId}, 'pending', ${now()})`;
  }
  queueManagers(workId: string) {
    const work = this.get(workId);
    if (!work || !["active", "waiting"].includes(work.state)) return;
    for (const row of this
      .sql<Row>`SELECT * FROM team_assignments WHERE work_id = ${workId} AND state = 'submitted' AND waiting = 1 AND ready = 1`) {
      const id = text(row, "id");
      const botId = text(row, "bot_id");
      const children = work.assignments.filter((item) => item.parentId === id);
      if (
        children.some((item) => ["queued", "submitted"].includes(item.state)) &&
        !work.updates?.some((item) => item.recipientBotId === botId && !item.acknowledged)
      )
        continue;
      if (
        this
          .sql`SELECT id FROM team_turns WHERE assignment_id = ${id} AND state IN ('pending', 'submitted')`
          .length
      )
        continue;
      const round = Number(row.round) + 1;
      if (round > 60) {
        this.cancelChildren(id);
        this
          .sql`INSERT OR IGNORE INTO team_cancellations (work_id, bot_id) VALUES (${workId}, ${botId})`;
        this
          .sql`UPDATE team_assignments SET state = 'failed', result = 'The manager reached its review limit' WHERE id = ${id}`;
        continue;
      }
      this
        .sql`UPDATE team_assignments SET ready = 0, waiting = 0, round = ${round} WHERE id = ${id}`;
      this
        .sql`INSERT INTO team_turns (id, work_id, bot_id, assignment_id, state, created_at) VALUES (${`manager:${id}:${round}`}, ${workId}, ${botId}, ${id}, 'pending', ${now()})`;
    }
  }
  ownerReturned(id: string, botId: string, failed: boolean, token = "start") {
    const work = this.get(id);
    if (!work || work.ownerBotId !== botId || !["active", "waiting"].includes(work.state)) return;
    if (this.ownerToken(id) !== token) return;
    if (failed)
      this.stop(
        id,
        "The coordinating turn failed. Review the conversation before starting again.",
        "failed"
      );
    else {
      // A final reply is not completion evidence. Resume the owner to save its reviews and checks.
      this.sql`UPDATE team_work SET state = 'waiting', owner_ready = 1 WHERE id = ${id}`;
      this.queueOwner(id);
    }
  }
}
