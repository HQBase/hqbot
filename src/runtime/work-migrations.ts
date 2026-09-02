import type { Sql } from "../workspace/sql";
import { migrateExternalEffects } from "./external-effects";

function isApplied(sql: Sql, version: number): boolean {
  return (
    sql<{ version: number }>`SELECT version FROM hqbot_work_migrations
    WHERE version = ${version}`.length > 0
  );
}

function record(sql: Sql, version: number): void {
  sql`INSERT INTO hqbot_work_migrations (version, applied_at)
    VALUES (${version}, ${new Date().toISOString()})`;
}

function migrateOne(sql: Sql): void {
  if (isApplied(sql, 1)) return;
  sql`CREATE TABLE IF NOT EXISTS hqbot_active_work (
    slot INTEGER PRIMARY KEY CHECK (slot = 1),
    task_id TEXT NOT NULL,
    goal TEXT NOT NULL,
    checkpoint TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
      'running', 'scheduled', 'waiting', 'needs_user', 'uncertain',
      'done', 'failed', 'cancelled'
    )),
    generation INTEGER NOT NULL,
    wake_at TEXT,
    schedule_id TEXT,
    submission_id TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  record(sql, 1);
}

function createProcessTableV4(sql: Sql): void {
  sql`CREATE TABLE IF NOT EXISTS hqbot_linux_process_v4 (
    slot INTEGER PRIMARY KEY CHECK (slot = 1),
    process_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
      'preparing', 'running', 'finalizing', 'completed', 'failed',
      'uncertain', 'cancelling', 'cancelled'
    )),
    run_root TEXT NOT NULL,
    output_root TEXT NOT NULL,
    script_path TEXT NOT NULL,
    staged_json TEXT NOT NULL,
    outputs_json TEXT NOT NULL,
    failure_count INTEGER NOT NULL,
    poll_schedule_id TEXT,
    poll_token INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    result_json TEXT,
    updated_at TEXT NOT NULL
  )`;
}

function migrateTwo(sql: Sql): void {
  if (isApplied(sql, 2)) return;
  sql`CREATE TABLE IF NOT EXISTS hqbot_linux_process (
    slot INTEGER PRIMARY KEY CHECK (slot = 1),
    process_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
      'preparing', 'running', 'finalizing', 'completed', 'failed',
      'uncertain', 'cancelled'
    )),
    run_root TEXT NOT NULL,
    output_root TEXT NOT NULL,
    script_path TEXT NOT NULL,
    staged_json TEXT NOT NULL,
    outputs_json TEXT NOT NULL,
    failure_count INTEGER NOT NULL,
    poll_schedule_id TEXT,
    poll_token INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    result_json TEXT,
    updated_at TEXT NOT NULL
  )`;
  record(sql, 2);
}

function migrateThree(sql: Sql): void {
  if (isApplied(sql, 3)) return;
  migrateExternalEffects(sql);
  record(sql, 3);
}

function migrateFour(sql: Sql): void {
  if (isApplied(sql, 4)) return;
  createProcessTableV4(sql);
  sql`INSERT INTO hqbot_linux_process_v4 SELECT * FROM hqbot_linux_process WHERE true
    ON CONFLICT(slot) DO UPDATE SET
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
  record(sql, 4);
}

export function migrateTeammateWork(sql: Sql): void {
  sql`CREATE TABLE IF NOT EXISTS hqbot_work_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`;
  migrateOne(sql);
  migrateTwo(sql);
  migrateThree(sql);
  migrateFour(sql);
}
