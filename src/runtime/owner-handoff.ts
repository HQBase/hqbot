import type { Sql } from "../workspace/sql";
import { ActionHistory } from "./action-history";

export function migrateOwnerHandoffs(sql: Sql) {
  sql`CREATE TABLE IF NOT EXISTS hqbot_owner_handoffs (
    id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('pending', 'resuming', 'completed', 'cancelled')),
    team_work_id TEXT, created_at TEXT NOT NULL
  )`;
}

export class OwnerHandoffs {
  private operation: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly sql: Sql,
    private readonly host: {
      allowed(): Promise<boolean>;
      teamWorkId(): Promise<string | undefined>;
      release(): Promise<unknown>;
      reconnect(): Promise<unknown>;
      scheduleRecovery(): Promise<void>;
      flush(): Promise<void>;
      transaction<T>(fn: () => T): T;
    }
  ) {}

  pending() {
    return (
      this.sql<{
        id: string;
        state: string;
        team_work_id: string | null;
      }>`SELECT id, state, team_work_id FROM hqbot_owner_handoffs WHERE state IN ('pending', 'resuming') ORDER BY created_at DESC LIMIT 1`[0] ??
      null
    );
  }

  async record(id: string) {
    const teamWorkId = await this.host.teamWorkId();
    this.host.transaction(() => {
      if (this.sql`SELECT id FROM hqbot_owner_handoffs WHERE id = ${id}`.length) return;
      this.cancel();
      this
        .sql`INSERT INTO hqbot_owner_handoffs (id, state, team_work_id, created_at) VALUES (${id}, 'pending', ${teamWorkId ?? null}, ${new Date().toISOString()})`;
    });
  }

  cancel() {
    this
      .sql`DELETE FROM hqbot_action_continuations WHERE submitted = 0 AND id IN (SELECT 'handoff:' || id FROM hqbot_owner_handoffs)`;
    this
      .sql`UPDATE hqbot_owner_handoffs SET state = 'cancelled' WHERE state IN ('pending', 'resuming')`;
  }

  private async assertCurrent(id: string) {
    const current = this.pending();
    if (!current || current.id !== id)
      throw new Error("This computer handoff is no longer pending");
    if (
      !(await this.host.allowed()) ||
      current.team_work_id !== ((await this.host.teamWorkId()) ?? null)
    ) {
      this.cancel();
      throw new Error("This task can no longer resume");
    }
    return current;
  }

  reconnect(id: string) {
    return this.run(async () => {
      const current = await this.assertCurrent(id);
      if (current.state !== "pending") throw new Error("The teammate is already resuming");
      return this.host.reconnect();
    });
  }

  finish(id: string) {
    return this.run(async () => {
      const saved = this.sql<{
        state: string;
      }>`SELECT state FROM hqbot_owner_handoffs WHERE id = ${id}`[0];
      if (saved?.state === "completed") return { resumed: true };
      await this.assertCurrent(id);
      await this.host.scheduleRecovery();
      this.sql`UPDATE hqbot_owner_handoffs SET state = 'resuming' WHERE id = ${id}`;
      await this.host.release();
      await this.assertCurrent(id);
      this.host.transaction(() => {
        new ActionHistory(this.sql).enqueue(
          `handoff:${id}`,
          "The owner selected “I’m done—continue” in the computer handoff. Computer control has been returned. Continue the saved task from the current page; verify the sign-in or requested step without repeating earlier actions."
        );
        this.sql`UPDATE hqbot_owner_handoffs SET state = 'completed' WHERE id = ${id}`;
      });
      await this.host.flush();
      return { resumed: true };
    });
  }

  async recover() {
    const current = this.pending();
    if (current?.state === "resuming") await this.finish(current.id);
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.operation.then(fn, fn);
    this.operation = result.catch(() => undefined);
    return result;
  }
}
