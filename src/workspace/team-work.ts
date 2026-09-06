import type { TeamWorkInput } from "../domain/team-work";
import { WorkspaceProjects } from "./projects";
import { now, type Row } from "./sql";
import { WorkspaceTeam } from "./team";
import { TeamWorkStore } from "./team-work-store";

export class WorkspaceTeamWork extends TeamWorkStore {
  start(
    botId: string,
    id: string,
    input: Extract<TeamWorkInput, { action: "start" }>,
    maxBudget: number,
    requesterId?: string
  ) {
    const existing = this.get(id);
    if (existing) {
      if (
        existing.ownerBotId !== botId ||
        existing.goal !== input.goal ||
        JSON.stringify(existing.criteria) !== JSON.stringify(input.criteria) ||
        this.sql<Row>`SELECT start_input FROM team_work WHERE id = ${id}`[0]?.start_input !==
          JSON.stringify({ input, requesterId })
      )
        throw new Error("Team task ID is already in use");
      return existing;
    }
    if (this.activeOwner(botId))
      throw new Error("Finish or stop your current team task first. Use coordinate status.");
    if (
      this
        .sql`SELECT id FROM team_turns WHERE bot_id = ${botId} AND assignment_id IS NOT NULL AND state = 'submitted'`
        .length
    )
      throw new Error(
        "Specialists cannot delegate their assignment. Return the result to the owner."
      );
    const bot = this.catalog.getBot(botId);
    if (!bot || bot.hidden) throw new Error("The task owner is not available");
    if (input.projectId) {
      const project = new WorkspaceProjects(this.sql).assertMember(input.projectId, botId);
      if (project.leadBotId !== botId) throw new Error("Only the group lead can own its team task");
    } else if (bot.coordinationRole !== "chief")
      throw new Error("Use Chief of Staff for team work, or choose a group you belong to.");
    if (requesterId && !new WorkspaceTeam(this.sql).canBot(requesterId, botId, true))
      throw new Error("The requester cannot start work with this teammate");
    const deadline = input.deadlineAt ?? new Date(Date.now() + 86400000).toISOString();
    if (Date.parse(deadline) <= Date.now() || Date.parse(deadline) > Date.now() + 7 * 86400000)
      throw new Error("Choose a future deadline within seven days");
    const budget = Math.min(input.budgetUsd ?? maxBudget, maxBudget, bot.dailyBudgetUsd);
    this
      .sql`INSERT INTO team_work (id, owner_bot_id, project_id, requester_id, goal, criteria, deadline_at, budget_usd, state, start_input, created_at, updated_at) VALUES (${id}, ${botId}, ${input.projectId ?? null}, ${requesterId ?? null}, ${input.goal}, ${JSON.stringify(input.criteria)}, ${deadline}, ${budget}, 'active', ${JSON.stringify({ input, requesterId })}, ${now()}, ${now()})`;
    return this.get(id);
  }
  assign(botId: string, id: string, input: Extract<TeamWorkInput, { action: "assign" }>) {
    const work = this.owner(id, botId);
    if (work.state !== "active")
      throw new Error("Wait for the current assignments before adding work");
    const previous = work.assignments.find((item) => item.key === input.key);
    if (previous) {
      if (
        previous.botId !== input.botId ||
        previous.instruction !== input.instruction ||
        previous.criterion !== input.criterion
      )
        throw new Error("This assignment key is already in use");
      return previous;
    }
    if (work.assignments.length >= 20)
      throw new Error("The team task assignment limit was reached");
    if (work.assignments.filter((item) => ["queued", "submitted"].includes(item.state)).length >= 6)
      throw new Error("Wait for the current specialists before assigning more work");
    if (input.botId === botId || this.catalog.getBot(input.botId)?.hidden !== false)
      throw new Error("Choose another active teammate");
    if (work.projectId) new WorkspaceProjects(this.sql).assertMember(work.projectId, input.botId);
    const requester = this.sql<Row>`SELECT requester_id FROM team_work WHERE id = ${id}`[0]
      ?.requester_id;
    if (requester && !new WorkspaceTeam(this.sql).canBot(String(requester), input.botId, true))
      throw new Error("The requester cannot assign this teammate");
    if (
      work.assignments.some(
        (item) =>
          ["queued", "submitted"].includes(item.state) &&
          (item.botId === input.botId || item.instruction.trim() === input.instruction.trim())
      )
    )
      throw new Error("This teammate or assignment is already working on this task");
    const assignmentId = `${id}:${input.key}`;
    this
      .sql`INSERT INTO team_assignments (id, work_id, assignment_key, bot_id, instruction, criterion, state, updated_at) VALUES (${assignmentId}, ${id}, ${input.key}, ${input.botId}, ${input.instruction}, ${input.criterion}, 'queued', ${now()})`;
    this
      .sql`INSERT INTO team_turns (id, work_id, bot_id, assignment_id, state, created_at) VALUES (${`assignment:${assignmentId}`}, ${id}, ${input.botId}, ${assignmentId}, 'pending', ${now()})`;
    this.touch(id);
    return this.assignments(id).find((item) => item.id === assignmentId);
  }
  review(botId: string, id: string, input: Extract<TeamWorkInput, { action: "review" }>) {
    const work = this.owner(id, botId);
    const item = work.assignments.find((item) => item.id === input.assignmentId);
    if (!item || !["returned", "reviewed", "rejected", "failed"].includes(item.state))
      throw new Error("The assignment has no returned result to review");
    if (input.accepted && ["failed", "rejected"].includes(item.state))
      throw new Error(
        "A failed or rejected assignment cannot be accepted. Assign a new attempt with a new key."
      );
    if (item.state === "reviewed") {
      if (!input.accepted || item.review !== input.check)
        throw new Error("This result already has a saved review");
      return item;
    }
    this
      .sql`UPDATE team_assignments SET state = ${input.accepted ? "reviewed" : "rejected"}, review = ${input.check}, updated_at = ${now()} WHERE id = ${item.id}`;
    this.touch(id);
    return this.get(id);
  }
  wait(botId: string, id: string) {
    const work = this.owner(id, botId);
    if (
      !work.assignments.some((item) =>
        ["queued", "submitted", "returned", "failed"].includes(item.state)
      )
    )
      throw new Error(
        "No assignments need a result or review. Finish the task or assign the next step."
      );
    this.sql`UPDATE team_work SET state = 'waiting', updated_at = ${now()} WHERE id = ${id}`;
    return {
      waiting: true,
      workId: id,
      message:
        "End this turn. You will resume once the current specialists have returned. Do not poll or schedule another wake."
    };
  }
  finish(botId: string, id: string, input: Extract<TeamWorkInput, { action: "finish" }>) {
    const saved = this.get(id);
    if (saved?.ownerBotId === botId && saved.state === "completed") {
      if (
        saved.result !== input.result ||
        this.sql<Row>`SELECT checks FROM team_work WHERE id = ${id}`[0]?.checks !==
          JSON.stringify(input.checks)
      )
        throw new Error("This task already has a different saved result or completion checks");
      return saved;
    }
    const work = this.owner(id, botId);
    if (
      work.assignments.some((item) =>
        ["queued", "submitted", "returned", "failed"].includes(item.state)
      )
    )
      throw new Error(
        "Review every assignment result before finishing. Use coordinate status and review."
      );
    if (work.assignments.length && !work.assignments.some((item) => item.state === "reviewed"))
      throw new Error(
        "No specialist result passed review. Resolve the failed work before finishing."
      );
    if (
      work.assignments.some(
        (item) =>
          item.state === "rejected" &&
          !work.assignments.some(
            (replacement) =>
              replacement.state === "reviewed" && replacement.criterion === item.criterion
          )
      )
    )
      throw new Error(
        "Replace each rejected assignment with a reviewed result for the same criterion"
      );
    if (
      work.criteria.some(
        (_, index) => !input.checks.find((check) => check.criterion === index)?.check.trim()
      )
    )
      throw new Error(
        "Include a check for every saved completion criterion, using its zero-based criterion number."
      );
    this
      .sql`UPDATE team_work SET state = 'completed', result = ${input.result}, checks = ${JSON.stringify(input.checks)}, updated_at = ${now()} WHERE id = ${id}`;
    this
      .sql`UPDATE team_turns SET state = 'completed' WHERE work_id = ${id} AND assignment_id IS NULL AND state IN ('pending', 'submitted')`;
    return this.get(id);
  }
  protected touch(id: string) {
    this.sql`UPDATE team_work SET updated_at = ${now()} WHERE id = ${id}`;
  }
}
