import {
  MAX_ASSIGNMENT_QUESTIONS,
  MAX_TASK_QUESTIONS,
  QUESTION_TIMEOUT_MS,
  type TeamQuestion,
  teamQuestions
} from "../domain/team-questions";
import type { TeamWork, TeamWorkInput } from "../domain/team-work";
import { now, type Row } from "./sql";
import { WorkspaceTeamWork } from "./team-work";

export class TeamWorkQuestions extends WorkspaceTeamWork {
  private specialist(workId: string, botId: string) {
    const work = this.assertAllowed(workId, botId);
    const assignment = this.activeAssignment(work, botId);
    if (!assignment || work.assignments.some((item) => item.parentId === assignment.id))
      throw new Error("Questions are between active specialists on the same task");
    return { work, assignment };
  }

  peers(botId: string, workId: string) {
    const { work } = this.specialist(workId, botId);
    return work.assignments.flatMap((item) => {
      if (item.botId === botId || !["queued", "submitted"].includes(item.state)) return [];
      try {
        this.specialist(workId, item.botId);
        return [
          {
            botId: item.botId,
            name: this.catalog.getBot(item.botId)?.name,
            criterion: item.criterion
          }
        ];
      } catch {
        return [];
      }
    });
  }

  ask(botId: string, workId: string, input: Extract<TeamWorkInput, { action: "ask" }>) {
    const { work, assignment } = this.specialist(workId, botId);
    const id = `question:${assignment.id}:${input.key}`;
    const questions = teamQuestions(work.updates);
    const prior = questions.find((item) => item.id === id);
    if (prior) {
      if (prior.recipientBotId !== input.botId || prior.question !== input.question)
        throw new Error("This question key is already in use");
      return { questionId: prior.id, pending: !prior.response, response: prior.response?.message };
    }
    if (input.botId === botId) throw new Error("Choose another specialist");
    const target = this.specialist(workId, input.botId).assignment;
    if (questions.some((item) => !item.response && item.sourceAssignmentId === assignment.id))
      throw new Error("Wait for your pending answer before asking another question");
    if (questions.some((item) => !item.response && item.targetAssignmentId === assignment.id))
      throw new Error(
        "Answer incoming questions first. Do not forward a question to another specialist"
      );
    if (questions.some((item) => !item.response && item.sourceAssignmentId === target.id))
      throw new Error(
        "That specialist is waiting for an answer. Choose another peer or report the blocker"
      );
    if (
      questions.length >= MAX_TASK_QUESTIONS ||
      questions.filter((item) => item.sourceAssignmentId === assignment.id).length >=
        MAX_ASSIGNMENT_QUESTIONS ||
      (work.updates?.length ?? 0) >= 160
    )
      throw new Error(
        "The question limit was reached. Report the remaining blocker to your manager"
      );
    this
      .sql`INSERT INTO team_updates (id, work_id, assignment_id, sender_bot_id, recipient_bot_id, kind, message, created_at) VALUES (${id}, ${workId}, ${target.id}, ${botId}, ${input.botId}, 'question', ${JSON.stringify({ sourceAssignmentId: assignment.id, text: input.question })}, ${now()})`;
    this.touch(workId);
    return {
      questionId: id,
      pending: true,
      message: "Question saved. Continue independent work or use coordinate wait. Do not poll."
    };
  }

  answer(botId: string, workId: string, input: Extract<TeamWorkInput, { action: "answer" }>) {
    const { work, assignment } = this.specialist(workId, botId);
    const question = teamQuestions(work.updates).find((item) => item.id === input.questionId);
    if (
      !question ||
      question.targetAssignmentId !== assignment.id ||
      question.recipientBotId !== botId
    )
      throw new Error("This question is not addressed to your current assignment");
    if (question.response) {
      if (question.response.kind !== "answer" || question.response.message !== input.answer)
        throw new Error("This question already has a saved answer or is closed");
      return { saved: true, questionId: question.id };
    }
    if (this.specialist(workId, question.senderBotId).assignment.id !== question.sourceAssignmentId)
      throw new Error("The requesting assignment changed");
    if (Date.now() - Date.parse(question.createdAt) >= QUESTION_TIMEOUT_MS)
      throw new Error("This question expired. Continue your assignment");
    this.respond(workId, question, input.answer, "answer");
    return {
      saved: true,
      questionId: question.id,
      message:
        "Answer saved. Continue your own assignment; ownership and permissions have not changed."
    };
  }

  private respond(
    workId: string,
    question: TeamQuestion,
    message: string,
    kind: "answer" | "question_closed"
  ) {
    this
      .sql`INSERT OR IGNORE INTO team_updates (id, work_id, assignment_id, sender_bot_id, recipient_bot_id, kind, message, created_at) VALUES (${`answer:${question.id}`}, ${workId}, ${question.sourceAssignmentId}, ${question.recipientBotId}, ${question.senderBotId}, ${kind}, ${message}, ${now()})`;
    this.sql`UPDATE team_updates SET acknowledged = 1 WHERE id = ${question.id}`;
    this.touch(workId);
  }

  reconcileQuestions(workId: string) {
    const work = this.get(workId);
    if (!work || !["active", "waiting"].includes(work.state)) return;
    for (const question of teamQuestions(work.updates).filter((item) => !item.response)) {
      let reason = "";
      try {
        const source = this.specialist(workId, question.senderBotId).assignment;
        const target = this.specialist(workId, question.recipientBotId).assignment;
        if (source.id !== question.sourceAssignmentId || target.id !== question.targetAssignmentId)
          reason = "An assignment changed before an answer was available.";
      } catch {
        reason = "A specialist is no longer available for this question.";
      }
      if (!reason && Date.now() - Date.parse(question.createdAt) >= QUESTION_TIMEOUT_MS)
        reason =
          "No answer arrived within ten minutes. Use existing evidence or report the blocker to your manager.";
      if (reason) this.respond(workId, question, reason, "question_closed");
    }
  }

  override wait(botId: string, workId: string) {
    const work = this.assertAllowed(workId, botId);
    const assignment = this.activeAssignment(work, botId);
    if (assignment && !work.assignments.some((item) => item.parentId === assignment.id)) {
      const questions = teamQuestions(work.updates);
      if (questions.some((item) => item.targetAssignmentId === assignment.id && !item.response))
        throw new Error("Answer incoming questions before waiting");
      if (
        !questions.some(
          (item) => item.sourceAssignmentId === assignment.id && !item.response?.acknowledged
        )
      )
        throw new Error(
          "There is no pending peer answer. Continue or return your assignment result"
        );
      this.sql`UPDATE team_assignments SET waiting = 1 WHERE id = ${assignment.id}`;
      return {
        waiting: true,
        workId,
        message:
          "End this turn. The saved answer or a closure will resume your assignment. Do not poll or schedule a wake."
      };
    }
    return super.wait(botId, workId);
  }

  // Called only after external actions and their result continuations have settled.
  protected parkForQuestions(work: TeamWork, assignmentId: string, botId: string) {
    for (const question of teamQuestions(work.updates)) {
      if (question.targetAssignmentId !== assignmentId || question.response) continue;
      const delivered = this
        .sql<Row>`SELECT delivered FROM team_updates WHERE id = ${question.id}`[0]?.delivered;
      if (delivered)
        this.respond(
          work.id,
          question,
          "The specialist finished without answering. Use its reviewed result or report the blocker.",
          "question_closed"
        );
    }
    this
      .sql`UPDATE team_updates SET acknowledged = 1 WHERE work_id = ${work.id} AND recipient_bot_id = ${botId} AND kind IN ('answer', 'question_closed') AND delivered = 1`;
    const pending = this.updates(work.id).some(
      (item) =>
        !item.acknowledged &&
        ((item.kind === "question" &&
          (item.senderBotId === botId || item.recipientBotId === botId)) ||
          (["answer", "question_closed"].includes(item.kind) && item.recipientBotId === botId))
    );
    if (pending)
      this.sql`UPDATE team_assignments SET waiting = 1, ready = 1 WHERE id = ${assignmentId}`;
    return pending;
  }

  queueQuestionTurns(workId: string) {
    this.reconcileQuestions(workId);
    const work = this.get(workId);
    if (!work || !["active", "waiting"].includes(work.state)) return;
    for (const row of this
      .sql<Row>`SELECT * FROM team_assignments WHERE work_id = ${workId} AND state = 'submitted' AND waiting = 1 AND ready = 1`) {
      if (work.assignments.some((item) => item.parentId === row.id)) continue;
      if (
        !work.updates?.some(
          (item) =>
            item.recipientBotId === row.bot_id &&
            !item.acknowledged &&
            ["question", "answer", "question_closed"].includes(item.kind)
        )
      )
        continue;
      if (
        this
          .sql`SELECT id FROM team_turns WHERE assignment_id = ${row.id} AND state IN ('pending', 'submitted')`
          .length
      )
        continue;
      const round = Number(row.round) + 1;
      this
        .sql`UPDATE team_assignments SET waiting = 0, ready = 0, round = ${round} WHERE id = ${row.id}`;
      this
        .sql`INSERT INTO team_turns (id, work_id, bot_id, assignment_id, state, created_at) VALUES (${`peer:${row.id}:${round}`}, ${workId}, ${row.bot_id}, ${row.id}, 'pending', ${now()})`;
    }
  }
}
