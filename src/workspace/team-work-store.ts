import type { TeamAssignment, TeamUpdate, TeamWork } from "../domain/team-work";
import { WorkspaceCatalog } from "./catalog";
import { WorkspaceProjects } from "./projects";
import { now, nullableText, type Row, type Sql, text } from "./sql";
import { WorkspaceTeam } from "./team";
import { WorkspaceTeamPolicy } from "./team-policy";

export class TeamWorkStore {
  protected readonly catalog: WorkspaceCatalog;
  constructor(protected readonly sql: Sql) {
    this.catalog = new WorkspaceCatalog(sql);
  }
  get(id: string): TeamWork | null {
    const row = this.sql<Row>`SELECT * FROM team_work WHERE id = ${id}`[0];
    if (!row) return null;
    return {
      id,
      ownerBotId: text(row, "owner_bot_id"),
      projectId: nullableText(row, "project_id"),
      goal: text(row, "goal"),
      criteria: JSON.parse(text(row, "criteria")),
      deadlineAt: text(row, "deadline_at"),
      budgetUsd: Number(row.budget_usd),
      spentUsd: this.spent(id),
      state: text(row, "state"),
      result: nullableText(row, "result"),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
      assignments: this.assignments(id),
      updates: this.updates(id)
    };
  }
  assignments(id: string): TeamAssignment[] {
    return this
      .sql<Row>`SELECT * FROM team_assignments WHERE work_id = ${id} ORDER BY updated_at, id`.map(
      (row) => ({
        id: text(row, "id"),
        workId: id,
        key: text(row, "assignment_key"),
        botId: text(row, "bot_id"),
        instruction: text(row, "instruction"),
        criterion: text(row, "criterion"),
        state: text(row, "state"),
        result: nullableText(row, "result"),
        review: nullableText(row, "review"),
        updatedAt: text(row, "updated_at"),
        parentId: nullableText(row, "parent_id"),
        managerBotId: text(row, "manager_bot_id"),
        depth: Number(row.depth),
        waiting: Boolean(row.waiting),
        modelId: nullableText(row, "model_id"),
        progress: row.progress_json ? JSON.parse(String(row.progress_json)) : null
      })
    );
  }
  updates(id: string): TeamUpdate[] {
    return this
      .sql<Row>`SELECT * FROM team_updates WHERE work_id = ${id} ORDER BY created_at, id`.map(
      (row) => ({
        id: text(row, "id"),
        assignmentId: nullableText(row, "assignment_id"),
        senderBotId: text(row, "sender_bot_id"),
        recipientBotId: text(row, "recipient_bot_id"),
        kind: text(row, "kind"),
        message: text(row, "message"),
        acknowledged: Boolean(row.acknowledged),
        createdAt: text(row, "created_at")
      })
    );
  }
  activeAssignment(work: TeamWork, botId: string) {
    return work.assignments.find(
      (item) => item.botId === botId && ["queued", "submitted"].includes(item.state)
    );
  }
  managed(work: TeamWork, botId: string) {
    return work.assignments.filter((item) => (item.managerBotId ?? work.ownerBotId) === botId);
  }
  manager(id: string, botId: string) {
    const work = this.assertAllowed(id, botId);
    if (work.ownerBotId === botId) return { work, parent: null };
    const parent = this.activeAssignment(work, botId);
    if (!parent || !new WorkspaceTeamPolicy(this.sql).get(botId).canManage)
      throw new Error(
        "Only the task owner or an owner-approved manager can delegate or review work"
      );
    return { work, parent };
  }
  forBot(botId: string, id?: string) {
    const row = id
      ? this.get(id)
      : this.sql<{
          id: string;
        }>`SELECT DISTINCT w.id FROM team_work w LEFT JOIN team_assignments a ON a.work_id = w.id WHERE w.owner_bot_id = ${botId} OR a.bot_id = ${botId} ORDER BY w.updated_at DESC LIMIT 1`[0];
    if (!row) return null;
    const work = this.get(row.id);
    if (!work) return null;
    if (
      work.projectId &&
      !new WorkspaceProjects(this.sql).list(botId).some((project) => project.id === work.projectId)
    )
      return null;
    if (work.ownerBotId === botId) return work;
    const visible = new Set(
      work.assignments.filter((item) => item.botId === botId).map((item) => item.id)
    );
    for (let depth = 0; depth < 3; depth++)
      for (const item of work.assignments)
        if (item.parentId && visible.has(item.parentId)) visible.add(item.id);
    return visible.size
      ? {
          ...work,
          assignments: work.assignments.filter((item) => visible.has(item.id)),
          updates: work.updates?.filter(
            (item) => item.recipientBotId === botId || item.senderBotId === botId
          )
        }
      : null;
  }
  activeOwner(botId: string) {
    const row = this.sql<{
      id: string;
    }>`SELECT id FROM team_work WHERE owner_bot_id = ${botId} AND state IN ('active', 'waiting')`[0];
    return row ? this.get(row.id) : null;
  }
  spent(id: string) {
    return (
      this.sql<{
        amount: number;
      }>`SELECT COALESCE(SUM(estimated_usd), 0) AS amount FROM usage_events WHERE team_work_id = ${id}`[0]
        ?.amount ?? 0
    );
  }
  assertAllowed(id: string, botId: string, amount = 0, requestedModelId?: string): TeamWork {
    const work = this.get(id);
    if (!work || !["active", "waiting"].includes(work.state))
      throw new Error("This team task is no longer active");
    if (
      work.ownerBotId !== botId &&
      !work.assignments.some(
        (item) => item.botId === botId && ["queued", "submitted"].includes(item.state)
      )
    )
      throw new Error("This teammate has no active assignment");
    if (Date.parse(work.deadlineAt) <= Date.now())
      throw new Error("The team task deadline was reached");
    if (work.spentUsd + amount > work.budgetUsd || work.spentUsd >= work.budgetUsd)
      throw new Error("The team task cost budget was reached");
    const daily = this
      .sql<Row>`SELECT COALESCE(SUM(u.estimated_usd), 0) AS amount FROM usage_events u JOIN team_work w ON w.id = u.team_work_id WHERE w.owner_bot_id = ${work.ownerBotId} AND substr(u.created_at, 1, 10) = ${new Date().toISOString().slice(0, 10)}`[0];
    if (
      Number(daily?.amount) + amount >
      new WorkspaceTeamPolicy(this.sql).get(work.ownerBotId).dailyBudgetUsd
    )
      throw new Error("The daily team model budget was reached");
    if (
      this.catalog.getBot(work.ownerBotId)?.hidden !== false ||
      this.catalog.getBot(botId)?.hidden !== false
    )
      throw new Error("A team task member is no longer available");
    if (work.projectId) {
      const projects = new WorkspaceProjects(this.sql);
      if (projects.assertMember(work.projectId, work.ownerBotId).leadBotId !== work.ownerBotId)
        throw new Error("The group lead changed. Start a new task with its current lead.");
      projects.assertMember(work.projectId, botId);
    } else if (!new WorkspaceTeamPolicy(this.sql).get(work.ownerBotId).canManage)
      throw new Error("The owner disabled management for this task owner");
    let assignment = this.activeAssignment(work, botId);
    const policy = new WorkspaceTeamPolicy(this.sql);
    if (
      assignment &&
      work.assignments.some((child) => child.parentId === assignment?.id) &&
      !policy.get(botId).canManage
    )
      throw new Error("The owner disabled management for this teammate");
    if (
      assignment &&
      requestedModelId &&
      (!policy
        .get(assignment.managerBotId || work.ownerBotId)
        .allowedModelIds.includes(requestedModelId) ||
        !policy.get(work.ownerBotId).allowedModelIds.includes(requestedModelId))
    )
      throw new Error("The requested model or fallback is not allowed for this assignment");
    while (assignment) {
      const managerId = assignment.managerBotId || work.ownerBotId;
      if (
        assignment.modelId &&
        (!policy.get(managerId).allowedModelIds.includes(assignment.modelId) ||
          !policy.get(work.ownerBotId).allowedModelIds.includes(assignment.modelId))
      )
        throw new Error("The assignment model is no longer allowed");
      if (!assignment.parentId) break;
      const parent = work.assignments.find((item) => item.id === assignment?.parentId);
      if (
        !parent ||
        !["queued", "submitted"].includes(parent.state) ||
        this.catalog.getBot(parent.botId)?.hidden !== false ||
        !policy.get(parent.botId).canManage
      )
        throw new Error("The parent manager is no longer available or allowed to manage");
      if (work.projectId)
        new WorkspaceProjects(this.sql).assertMember(work.projectId, parent.botId);
      assignment = parent;
    }
    const row = this.sql<Row>`SELECT requester_id FROM team_work WHERE id = ${id}`[0];
    if (row?.requester_id) {
      const team = new WorkspaceTeam(this.sql);
      if (
        !team.canBot(text(row, "requester_id"), work.ownerBotId, true) ||
        !team.canBot(text(row, "requester_id"), botId, true)
      )
        throw new Error("The requester no longer has access to this teammate");
    }
    return work;
  }
  owner(id: string, botId: string) {
    const work = this.assertAllowed(id, botId);
    if (work.ownerBotId !== botId)
      throw new Error(
        "Only the task owner can assign, review, or finish team work. Return your result to the owner."
      );
    return work;
  }
  stop(id: string, reason: string, state = "cancelled") {
    const work = this.get(id);
    if (!work || !["active", "waiting"].includes(work.state)) return;
    for (const botId of new Set([
      work.ownerBotId,
      ...work.assignments
        .filter((item) => ["queued", "submitted"].includes(item.state))
        .map((item) => item.botId)
    ]))
      this.sql`INSERT OR IGNORE INTO team_cancellations (work_id, bot_id) VALUES (${id}, ${botId})`;
    this
      .sql`UPDATE team_work SET state = ${state}, result = ${reason}, updated_at = ${now()} WHERE id = ${id} AND state IN ('active', 'waiting')`;
    this
      .sql`UPDATE team_assignments SET state = 'cancelled', updated_at = ${now()} WHERE work_id = ${id} AND state IN ('queued', 'submitted')`;
    this
      .sql`UPDATE team_turns SET state = 'cancelled' WHERE work_id = ${id} AND state IN ('pending', 'submitted')`;
  }
  cancelBot(botId: string) {
    for (const row of this.sql<{
      id: string;
    }>`SELECT id FROM team_work WHERE owner_bot_id = ${botId} AND state IN ('active', 'waiting')`)
      this.stop(row.id, "The owner stopped the coordinating teammate");
    for (const row of this
      .sql<Row>`SELECT id FROM team_assignments WHERE bot_id = ${botId} AND state IN ('queued', 'submitted')`)
      this.cancelChildren(text(row, "id"));
    this
      .sql`UPDATE team_assignments SET state = 'failed', result = 'The specialist was stopped', updated_at = ${now()} WHERE bot_id = ${botId} AND state IN ('queued', 'submitted')`;
    this
      .sql`UPDATE team_turns SET state = 'cancelled' WHERE bot_id = ${botId} AND state IN ('pending', 'submitted')`;
  }
  cancelChildren(parentId: string) {
    for (const child of this
      .sql<Row>`SELECT id, bot_id, work_id FROM team_assignments WHERE parent_id = ${parentId} AND state IN ('queued', 'submitted')`) {
      this.cancelChildren(text(child, "id"));
      this
        .sql`INSERT OR IGNORE INTO team_cancellations (work_id, bot_id) VALUES (${child.work_id}, ${child.bot_id})`;
      this
        .sql`UPDATE team_assignments SET state = 'cancelled', updated_at = ${now()} WHERE id = ${child.id}`;
      this
        .sql`UPDATE team_turns SET state = 'cancelled' WHERE assignment_id = ${child.id} AND state IN ('pending', 'submitted')`;
    }
  }
}
