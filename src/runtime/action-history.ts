import type { ExecutionState, PendingAction } from "@cloudflare/codemode";
import type { ActionRecord, IntegrationApproval } from "../domain/actions";
import { type Row, type Sql, text } from "../workspace/sql";
import { canonicalizeJson, sha256Hex } from "./external-effects";

export function migrateActionHistory(sql: Sql): void {
  sql`CREATE TABLE IF NOT EXISTS hqbot_action_history (
    id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, seq INTEGER NOT NULL,
    connector TEXT NOT NULL, method TEXT NOT NULL, args TEXT NOT NULL,
    input_hash TEXT NOT NULL, state TEXT NOT NULL, result TEXT,
    updated_at TEXT NOT NULL, UNIQUE(execution_id, seq)
  )`;
  sql`CREATE TABLE IF NOT EXISTS hqbot_action_continuations (
    id TEXT PRIMARY KEY, message TEXT NOT NULL, submitted INTEGER NOT NULL DEFAULT 0
  )`;
}

export class ActionHistory {
  constructor(private readonly sql: Sql) {}

  async pending(action: PendingAction): Promise<IntegrationApproval> {
    const inputHash = await sha256Hex(
      canonicalizeJson({ connector: action.connector, method: action.method, args: action.args })
    );
    const id = `${action.executionId}:${action.seq}`;
    this.sql`INSERT OR IGNORE INTO hqbot_action_history
      (id, execution_id, seq, connector, method, args, input_hash, state, updated_at)
      VALUES (${id}, ${action.executionId}, ${action.seq}, ${action.connector}, ${action.method},
        ${canonicalizeJson(action.args)}, ${inputHash}, 'pending', ${new Date().toISOString()})`;
    return { ...action, inputHash };
  }

  decide(executionId: string, seq: number, hash: string, state: "approved" | "denied"): boolean {
    return (
      this
        .sql<Row>`UPDATE hqbot_action_history SET state = ${state}, updated_at = ${new Date().toISOString()}
      WHERE execution_id = ${executionId} AND seq = ${seq} AND input_hash = ${hash} AND state = 'pending' RETURNING id`
        .length === 1
    );
  }

  outcome(executionId: string, seq: number, state: string, result: unknown): void {
    this.sql`UPDATE hqbot_action_history SET state = ${state}, result = ${canonicalizeJson(result)},
      updated_at = ${new Date().toISOString()} WHERE execution_id = ${executionId} AND seq = ${seq}`;
  }

  list(): ActionRecord[] {
    return this
      .sql<Row>`SELECT * FROM hqbot_action_history ORDER BY updated_at DESC, id DESC LIMIT 100`.map(
      (row) => ({
        id: text(row, "id"),
        executionId: text(row, "execution_id"),
        seq: Number(row.seq),
        connector: text(row, "connector"),
        method: text(row, "method"),
        args: JSON.parse(text(row, "args")),
        inputHash: text(row, "input_hash"),
        state: text(row, "state"),
        result: row.result === null ? null : JSON.parse(text(row, "result")),
        updatedAt: text(row, "updated_at")
      })
    );
  }

  reconcileRejections(executions: Pick<ExecutionState, "id" | "status" | "log">[]): void {
    for (const action of this.list().filter((item) => item.state === "pending")) {
      const execution = executions.find((item) => item.id === action.executionId);
      const call = execution?.log.find((item) => item.seq === action.seq);
      if (
        execution?.status === "rejected" &&
        call &&
        (call.state === "reverted" || call.state === "pending")
      )
        this.decide(action.executionId, action.seq, action.inputHash, "denied");
    }
  }

  enqueue(id: string, message: string): void {
    this
      .sql`INSERT OR IGNORE INTO hqbot_action_continuations (id, message) VALUES (${id}, ${message})`;
  }

  async flush(submit: (id: string, message: string) => Promise<void>): Promise<void> {
    const rows = this.sql<{
      id: string;
      message: string;
    }>`SELECT id, message FROM hqbot_action_continuations WHERE submitted = 0`;
    for (const row of rows) {
      await submit(row.id, row.message);
      this.sql`UPDATE hqbot_action_continuations SET submitted = 1 WHERE id = ${row.id}`;
    }
  }
}
