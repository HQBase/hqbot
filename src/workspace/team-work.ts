import { teamQuestions } from "../domain/team-questions";
import type { TeamWorkInput } from "../domain/team-work";
import { WorkspaceProjects } from "./projects";
import { now, type Row } from "./sql";
import { WorkspaceTeam } from "./team";
import { WorkspaceTeamPolicy } from "./team-policy";
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
      throw new Error("Use the existing team task to delegate. Do not start a separate root task.");
    const bot = this.catalog.getBot(botId);
    if (!bot || bot.hidden) throw new Error("The task owner is not available");
    if (input.projectId) {
      const project = new WorkspaceProjects(this.sql).assertMember(input.projectId, botId);
      if (project.leadBotId !== botId) throw new Error("Only the group lead can own its team task");
    } else if (!new WorkspaceTeamPolicy(this.sql).get(botId).canManage)
      throw new Error("Use Chief of Staff or a teammate allowed to manage work.");
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
    const { work, parent } = this.manager(id, botId);
    const key = parent ? `${parent.id}:${input.key}` : input.key;
    const previous = work.assignments.find((item) => item.key === key);
    if (previous) {
      if (
        previous.botId !== input.botId ||
        previous.instruction !== input.instruction ||
        previous.criterion !== input.criterion ||
        (input.modelId !== undefined && previous.modelId !== input.modelId)
      )
        throw new Error("This assignment key is already in use");
      return previous;
    }
    if (work.assignments.length >= 40)
      throw new Error("The team task assignment limit was reached");
    const active = work.assignments.filter((item) => ["queued", "submitted"].includes(item.state));
    const branches = active.filter(
      (item) => item.id !== parent?.id && !active.some((child) => child.parentId === item.id)
    );
    const policies = new WorkspaceTeamPolicy(this.sql);
    if (
      branches.length >=
      Math.min(policies.get(work.ownerBotId).maxConcurrent, policies.get(botId).maxConcurrent)
    )
      throw new Error("Wait for the current specialists before assigning more work");
    if (
      input.botId === botId ||
      input.botId === work.ownerBotId ||
      this.catalog.getBot(input.botId)?.hidden !== false
    )
      throw new Error("Choose another active teammate");
    if ((parent?.depth ?? 0) >= 2)
      throw new Error("The team task reached its delegation depth limit");
    if (
      parent &&
      teamQuestions(work.updates).some(
        (item) =>
          !item.response &&
          (item.sourceAssignmentId === parent.id || item.targetAssignmentId === parent.id)
      )
    )
      throw new Error("Finish the pending specialist question before delegating work");
    const modelId =
      input.modelId ??
      this.catalog.getBot(input.botId)?.modelId ??
      new WorkspaceTeamPolicy(this.sql).get(botId).defaultModelId;
    for (const managerId of new Set([botId, work.ownerBotId]))
      if (!new WorkspaceTeamPolicy(this.sql).get(managerId).allowedModelIds.includes(modelId))
        throw new Error("Choose a model allowed by the owner for this manager and task");
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
    const assignmentId = `${id}:${key}`;
    this
      .sql`INSERT INTO team_assignments (id, work_id, assignment_key, bot_id, instruction, criterion, state, updated_at, parent_id, manager_bot_id, depth, model_id) VALUES (${assignmentId}, ${id}, ${key}, ${input.botId}, ${input.instruction}, ${input.criterion}, 'queued', ${now()}, ${parent?.id ?? null}, ${botId}, ${(parent?.depth ?? 0) + 1}, ${modelId})`;
    this
      .sql`INSERT INTO team_turns (id, work_id, bot_id, assignment_id, state, created_at) VALUES (${`assignment:${assignmentId}`}, ${id}, ${input.botId}, ${assignmentId}, 'pending', ${now()})`;
    this.touch(id);
    const saved = this.assignments(id).find((item) => item.id === assignmentId);
    if (!saved) throw new Error("The assignment could not be saved");
    return saved;
  }
  review(botId: string, id: string, input: Extract<TeamWorkInput, { action: "review" }>) {
    const { work } = this.manager(id, botId);
    const item = this.managed(work, botId).find((item) => item.id === input.assignmentId);
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
    const { work, parent } = this.manager(id, botId);
    if (
      !this.managed(work, botId).some((item) =>
        ["queued", "submitted", "returned", "failed"].includes(item.state)
      )
    )
      throw new Error(
        "No assignments need a result or review. Finish the task or assign the next step."
      );
    if (parent) this.sql`UPDATE team_assignments SET waiting = 1 WHERE id = ${parent.id}`;
    else this.sql`UPDATE team_work SET state = 'waiting', updated_at = ${now()} WHERE id = ${id}`;
    this
      .sql`UPDATE team_updates SET acknowledged = 1 WHERE work_id = ${id} AND recipient_bot_id = ${botId} AND kind = 'report' AND delivered = 1`;
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
    const { work, parent } = this.manager(id, botId);
    const assignments = parent ? this.managed(work, botId) : work.assignments;
    if (
      parent &&
      teamQuestions(work.updates).some(
        (item) =>
          (!item.response &&
            [item.sourceAssignmentId, item.targetAssignmentId].includes(parent.id)) ||
          (item.sourceAssignmentId === parent.id &&
            item.response &&
            !this.sql<Row>`SELECT delivered FROM team_updates WHERE id = ${item.response.id}`[0]
              ?.delivered)
      )
    )
      throw new Error("Read and resolve pending specialist questions before finishing");
    if (
      assignments.some((item) => ["queued", "submitted", "returned", "failed"].includes(item.state))
    )
      throw new Error(
        "Review every assignment result before finishing. Use coordinate status and review."
      );
    if (assignments.length && !assignments.some((item) => item.state === "reviewed"))
      throw new Error(
        "No specialist result passed review. Resolve the failed work before finishing."
      );
    if (
      assignments.some(
        (item) =>
          item.state === "rejected" &&
          !assignments.some(
            (replacement) =>
              replacement.state === "reviewed" &&
              replacement.criterion === item.criterion &&
              replacement.managerBotId === item.managerBotId
          )
      )
    )
      throw new Error(
        "Replace each rejected assignment with a reviewed result for the same criterion"
      );
    if (
      (parent ? [parent.criterion] : work.criteria).some(
        (_, index) => !input.checks.find((check) => check.criterion === index)?.check.trim()
      )
    )
      throw new Error(
        "Include a check for every saved completion criterion, using its zero-based criterion number."
      );
    if (parent) {
      const saved = this
        .sql<Row>`SELECT completion_ready, completion_checks FROM team_assignments WHERE id = ${parent.id}`[0];
      if (
        saved?.completion_ready &&
        (parent.result !== input.result || saved.completion_checks !== JSON.stringify(input.checks))
      )
        throw new Error(
          "This assignment already has a different saved result or completion checks"
        );
      this
        .sql`UPDATE team_assignments SET completion_ready = 1, result = ${input.result}, completion_checks = ${JSON.stringify(input.checks)} WHERE id = ${parent.id}`;
      return { state: "completed", assignmentId: parent.id, result: input.result };
    }
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
