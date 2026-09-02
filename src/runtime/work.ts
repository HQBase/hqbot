import type { ArtifactReference } from "../domain/types";
import { nullableText, number, type Row, type Sql, text } from "../workspace/sql";
import type { LinuxOutputSpec } from "./linux-shell";

export { migrateTeammateWork } from "./work-migrations";

export type WorkState =
  | "running"
  | "scheduled"
  | "waiting"
  | "needs_user"
  | "uncertain"
  | "done"
  | "failed"
  | "cancelled";

export interface ActiveWork {
  taskId: string;
  goal: string;
  checkpoint: string;
  state: WorkState;
  generation: number;
  wakeAt: string | null;
  scheduleId: string | null;
  submissionId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkResumePayload {
  taskId: string;
  generation: number;
  goal: string;
  checkpoint: string;
  createdAt: string;
  predecessorGeneration: number | null;
  predecessorTaskId: string | null;
  transitionAt: string;
}

export type ManagedLinuxProcessState =
  | "preparing"
  | "running"
  | "finalizing"
  | "completed"
  | "failed"
  | "uncertain"
  | "cancelling"
  | "cancelled";

export interface ManagedLinuxProcessResult {
  durationMs: number;
  exitCode: number;
  files: ArtifactReference[];
  stderr: string;
  stdout: string;
}

export interface ManagedLinuxProcess {
  processId: string;
  taskId: string;
  generation: number;
  state: ManagedLinuxProcessState;
  runRoot: string;
  outputRoot: string;
  scriptPath: string;
  staged: string[];
  outputs: LinuxOutputSpec[];
  failureCount: number;
  pollScheduleId: string | null;
  pollToken: number;
  startedAt: string;
  deadlineAt: string;
  result: ManagedLinuxProcessResult | null;
  updatedAt: string;
}

const terminalStates: readonly WorkState[] = ["done", "failed", "cancelled"];

export function isTerminalWork(state: WorkState): boolean {
  return terminalStates.includes(state);
}

function workFromRow(row: Row): ActiveWork {
  return {
    taskId: text(row, "task_id"),
    goal: text(row, "goal"),
    checkpoint: text(row, "checkpoint"),
    state: text(row, "state") as WorkState,
    generation: number(row, "generation"),
    wakeAt: nullableText(row, "wake_at"),
    scheduleId: nullableText(row, "schedule_id"),
    submissionId: nullableText(row, "submission_id"),
    lastError: nullableText(row, "last_error"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at")
  };
}

export class TeammateWorkStore {
  constructor(private readonly sql: Sql) {}

  current(): ActiveWork | null {
    const row = this.sql<Row>`SELECT * FROM hqbot_active_work WHERE slot = 1`[0];
    return row ? workFromRow(row) : null;
  }

  active(): ActiveWork | null {
    const work = this.current();
    return work && !isTerminalWork(work.state) ? work : null;
  }

  put(work: ActiveWork): ActiveWork {
    this.sql`INSERT INTO hqbot_active_work (
      slot, task_id, goal, checkpoint, state, generation, wake_at, schedule_id,
      submission_id, last_error, created_at, updated_at
    ) VALUES (
      1, ${work.taskId}, ${work.goal}, ${work.checkpoint}, ${work.state},
      ${work.generation}, ${work.wakeAt}, ${work.scheduleId}, ${work.submissionId},
      ${work.lastError}, ${work.createdAt}, ${work.updatedAt}
    ) ON CONFLICT(slot) DO UPDATE SET
      task_id = excluded.task_id,
      goal = excluded.goal,
      checkpoint = excluded.checkpoint,
      state = excluded.state,
      generation = excluded.generation,
      wake_at = excluded.wake_at,
      schedule_id = excluded.schedule_id,
      submission_id = excluded.submission_id,
      last_error = excluded.last_error,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at`;
    return work;
  }

  transition(expected: ActiveWork | null, work: ActiveWork): ActiveWork | null {
    const rows = expected
      ? this.sql<Row>`UPDATE hqbot_active_work SET
          task_id = ${work.taskId},
          goal = ${work.goal},
          checkpoint = ${work.checkpoint},
          state = ${work.state},
          generation = ${work.generation},
          wake_at = ${work.wakeAt},
          schedule_id = ${work.scheduleId},
          submission_id = ${work.submissionId},
          last_error = ${work.lastError},
          created_at = ${work.createdAt},
          updated_at = ${work.updatedAt}
        WHERE slot = 1
          AND task_id = ${expected.taskId}
          AND generation = ${expected.generation}
          AND state = ${expected.state}
          AND updated_at = ${expected.updatedAt}
        RETURNING *`
      : this.sql<Row>`INSERT INTO hqbot_active_work (
          slot, task_id, goal, checkpoint, state, generation, wake_at, schedule_id,
          submission_id, last_error, created_at, updated_at
        ) VALUES (
          1, ${work.taskId}, ${work.goal}, ${work.checkpoint}, ${work.state},
          ${work.generation}, ${work.wakeAt}, ${work.scheduleId}, ${work.submissionId},
          ${work.lastError}, ${work.createdAt}, ${work.updatedAt}
        ) ON CONFLICT(slot) DO NOTHING RETURNING *`;
    return rows[0] ? workFromRow(rows[0]) : null;
  }

  claimResume(payload: WorkResumePayload): ActiveWork | null {
    const current = this.current();
    const sameGeneration =
      current?.taskId === payload.taskId &&
      current.generation === payload.generation &&
      ["scheduled", "waiting", "running"].includes(current.state);
    const missingTransition =
      current?.taskId === payload.taskId &&
      !isTerminalWork(current.state) &&
      current.generation + 1 === payload.generation &&
      current.taskId === payload.predecessorTaskId &&
      current.generation === payload.predecessorGeneration;
    const newAfterTombstone =
      current !== null &&
      current.taskId !== payload.taskId &&
      isTerminalWork(current.state) &&
      current.taskId === payload.predecessorTaskId &&
      current.generation === payload.predecessorGeneration;
    if (current && !sameGeneration && !missingTransition && !newAfterTombstone) return null;

    return this.put({
      taskId: payload.taskId,
      goal: payload.goal,
      checkpoint: payload.checkpoint,
      state: "running",
      generation: payload.generation,
      wakeAt: null,
      scheduleId: null,
      submissionId:
        current?.taskId === payload.taskId && current.generation === payload.generation
          ? current.submissionId
          : null,
      lastError: null,
      createdAt: current?.taskId === payload.taskId ? current.createdAt : payload.createdAt,
      updatedAt: new Date().toISOString()
    });
  }

  setSubmission(taskId: string, generation: number, submissionId: string): ActiveWork | null {
    const current = this.current();
    if (
      !current ||
      current.taskId !== taskId ||
      current.generation !== generation ||
      current.state !== "running"
    ) {
      return null;
    }
    return this.put({
      ...current,
      submissionId,
      updatedAt: new Date().toISOString()
    });
  }
}

const terminalProcessStates: readonly ManagedLinuxProcessState[] = [
  "completed",
  "failed",
  "cancelled"
];

function processFromRow(row: Row): ManagedLinuxProcess {
  return {
    processId: text(row, "process_id"),
    taskId: text(row, "task_id"),
    generation: number(row, "generation"),
    state: text(row, "state") as ManagedLinuxProcessState,
    runRoot: text(row, "run_root"),
    outputRoot: text(row, "output_root"),
    scriptPath: text(row, "script_path"),
    staged: JSON.parse(text(row, "staged_json")) as string[],
    outputs: JSON.parse(text(row, "outputs_json")) as LinuxOutputSpec[],
    failureCount: number(row, "failure_count"),
    pollScheduleId: nullableText(row, "poll_schedule_id"),
    pollToken: number(row, "poll_token"),
    startedAt: text(row, "started_at"),
    deadlineAt: text(row, "deadline_at"),
    result: JSON.parse(
      nullableText(row, "result_json") ?? "null"
    ) as ManagedLinuxProcessResult | null,
    updatedAt: text(row, "updated_at")
  };
}

export class TeammateLinuxProcessStore {
  constructor(private readonly sql: Sql) {}

  current(): ManagedLinuxProcess | null {
    const row = this.sql<Row>`SELECT * FROM hqbot_linux_process_v4 WHERE slot = 1`[0];
    return row ? processFromRow(row) : null;
  }

  active(): ManagedLinuxProcess | null {
    const process = this.current();
    return process && !terminalProcessStates.includes(process.state) ? process : null;
  }

  put(process: ManagedLinuxProcess): ManagedLinuxProcess {
    this.sql`INSERT INTO hqbot_linux_process_v4 (
      slot, process_id, task_id, generation, state, run_root, output_root,
      script_path, staged_json, outputs_json, failure_count, poll_schedule_id,
      poll_token, started_at, deadline_at, result_json, updated_at
    ) VALUES (
      1, ${process.processId}, ${process.taskId}, ${process.generation}, ${process.state},
      ${process.runRoot}, ${process.outputRoot}, ${process.scriptPath},
      ${JSON.stringify(process.staged)}, ${JSON.stringify(process.outputs)},
      ${process.failureCount}, ${process.pollScheduleId}, ${process.pollToken},
      ${process.startedAt}, ${process.deadlineAt},
      ${process.result ? JSON.stringify(process.result) : null}, ${process.updatedAt}
    ) ON CONFLICT(slot) DO UPDATE SET
      process_id = excluded.process_id,
      task_id = excluded.task_id,
      generation = excluded.generation,
      state = excluded.state,
      run_root = excluded.run_root,
      output_root = excluded.output_root,
      script_path = excluded.script_path,
      staged_json = excluded.staged_json,
      outputs_json = excluded.outputs_json,
      failure_count = excluded.failure_count,
      poll_schedule_id = excluded.poll_schedule_id,
      poll_token = excluded.poll_token,
      started_at = excluded.started_at,
      deadline_at = excluded.deadline_at,
      result_json = excluded.result_json,
      updated_at = excluded.updated_at`;
    return process;
  }
}
