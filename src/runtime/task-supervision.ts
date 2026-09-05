import type { ActionRecord } from "../domain/actions";
import type { BotFile } from "../domain/types";
import { type Row, type Sql, text } from "../workspace/sql";
import type { TaskCriterion, TaskEvidence } from "./task-management";
import type { ActiveWork } from "./work";

export function migrateTaskSupervision(sql: Sql): void {
  sql`CREATE TABLE IF NOT EXISTS hqbot_task_plans (
    task_id TEXT PRIMARY KEY, criteria TEXT NOT NULL, criteria_defined INTEGER NOT NULL DEFAULT 0, retries INTEGER NOT NULL DEFAULT 0,
    stalled INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT -1, checkpoint TEXT NOT NULL DEFAULT ''
  )`;
  sql`CREATE TABLE IF NOT EXISTS hqbot_task_milestones (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, state TEXT NOT NULL, checkpoint TEXT NOT NULL,
    evidence TEXT, created_at TEXT NOT NULL
  )`;
}

export class TaskSupervision {
  constructor(
    private readonly sql: Sql,
    private readonly verifyFile: (id: string) => Promise<BotFile | null>,
    private readonly actions: () => ActionRecord[]
  ) {}

  configure(taskId: string, goal: string, criteria?: TaskCriterion[]): void {
    const value = JSON.stringify(
      criteria?.length ? criteria : [{ id: "result", description: goal }]
    );
    this
      .sql`INSERT OR IGNORE INTO hqbot_task_plans (task_id, criteria) VALUES (${taskId}, ${value})`;
    if (criteria?.length) {
      const ids = new Set(criteria.map((item) => item.id));
      if (ids.size !== criteria.length) throw new Error("Completion criteria must have unique IDs");
      const previous = this
        .sql<Row>`SELECT criteria, criteria_defined FROM hqbot_task_plans WHERE task_id = ${taskId}`[0];
      if (previous?.criteria_defined === 1 && text(previous, "criteria") !== value)
        throw new Error("Completion criteria are already saved for this task");
      this
        .sql`UPDATE hqbot_task_plans SET criteria = ${value}, criteria_defined = 1 WHERE task_id = ${taskId}`;
    }
  }

  criteria(taskId: string): TaskCriterion[] {
    const row = this.sql<Row>`SELECT criteria FROM hqbot_task_plans WHERE task_id = ${taskId}`[0];
    return row ? JSON.parse(text(row, "criteria")) : [];
  }

  observe(work: ActiveWork): string | null {
    this.configure(work.taskId, work.goal);
    const current = this.sql<Row>`SELECT * FROM hqbot_task_plans WHERE task_id = ${work.taskId}`[0];
    if (!current || Number(current.generation) >= work.generation) return null;
    const same = text(current, "checkpoint").trim() === work.checkpoint.trim();
    const stalled = same ? Number(current.stalled) + 1 : 0;
    this
      .sql`UPDATE hqbot_task_plans SET checkpoint = ${work.checkpoint}, generation = ${work.generation}, stalled = ${stalled} WHERE task_id = ${work.taskId}`;
    this
      .sql`INSERT OR IGNORE INTO hqbot_task_milestones (id, task_id, state, checkpoint, created_at)
      VALUES (${`${work.taskId}:${work.generation}`}, ${work.taskId}, ${work.state}, ${work.checkpoint}, ${work.updatedAt})`;
    return stalled >= 3 && ["scheduled", "running"].includes(work.state)
      ? "The task made no new progress in three continuations. Review the checkpoint before continuing."
      : null;
  }

  retryDelay(taskId: string, error: string): number | null {
    if (
      !/(429|rate.?limit|temporar|time.?out|502|503|504|network)/iu.test(error) ||
      /(401|403|auth|uncertain|unknown outcome|budget|token limit)/iu.test(error)
    )
      return null;
    const row = this.sql<Row>`SELECT retries FROM hqbot_task_plans WHERE task_id = ${taskId}`[0];
    const retries = Number(row?.retries ?? 0);
    if (retries >= 3) return null;
    this.sql`UPDATE hqbot_task_plans SET retries = retries + 1 WHERE task_id = ${taskId}`;
    return [5_000, 30_000, 120_000][retries] ?? null;
  }

  async verify(taskId: string, evidence: TaskEvidence[]): Promise<void> {
    const criteria = this.criteria(taskId);
    if (!criteria.length) throw new Error("Save completion criteria before finishing this task");
    for (const criterion of criteria) {
      const proof = evidence.find((item) => item.criterionId === criterion.id);
      if (!proof?.check.trim())
        throw new Error(`Verify completion criterion: ${criterion.description}`);
      if (criterion.artifactName) {
        const file = proof.artifactId ? await this.verifyFile(proof.artifactId) : null;
        if (!file || file.name !== criterion.artifactName)
          throw new Error(`The required saved file is missing: ${criterion.artifactName}`);
      }
      if (criterion.actionRequired) {
        const action = this.actions().find((item) => item.id === proof.actionId);
        if (!action || !["applied", "confirmed"].includes(action.state))
          throw new Error("The required external action has no confirmed result");
      }
    }
    this
      .sql`INSERT OR REPLACE INTO hqbot_task_milestones (id, task_id, state, checkpoint, evidence, created_at)
      VALUES (${`${taskId}:verified`}, ${taskId}, 'verified', 'Completion checks passed', ${JSON.stringify(evidence)}, ${new Date().toISOString()})`;
  }

  milestones(taskId: string) {
    return this
      .sql<Row>`SELECT id, state, checkpoint, evidence, created_at FROM hqbot_task_milestones WHERE task_id = ${taskId} ORDER BY created_at DESC LIMIT 100`;
  }
}
