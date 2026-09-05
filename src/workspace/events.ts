import {
  type EventFilter,
  type EventReceipt,
  type EventTrigger,
  eventTriggerInput,
  type VerifiedEvent
} from "../domain/events";
import { WorkspaceRoutines } from "./routines";
import { now, type Row, type Sql, text } from "./sql";

export class WorkspaceEvents {
  constructor(private readonly sql: Sql) {}
  private from(row: Row): EventTrigger {
    return {
      id: text(row, "id"),
      botId: text(row, "bot_id"),
      routineId: text(row, "routine_id"),
      name: text(row, "name"),
      revision: Number(row.revision),
      enabled: row.enabled === 1,
      filter: JSON.parse(text(row, "filter_json")) as EventFilter,
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at")
    };
  }
  list(routineId: string) {
    return this
      .sql<Row>`SELECT * FROM event_triggers WHERE routine_id = ${routineId} ORDER BY created_at`.map(
      (row) => this.from(row)
    );
  }
  read(id: string): (EventTrigger & { secret: string }) | null {
    const row = this.sql<Row>`SELECT * FROM event_triggers WHERE id = ${id}`[0];
    return row ? { ...this.from(row), secret: text(row, "secret") } : null;
  }
  save(value: unknown): { trigger: EventTrigger; secret?: string } {
    const input = eventTriggerInput.parse(value);
    const current = this.read(input.id);
    if (
      current &&
      (current.revision !== input.revision ||
        current.botId !== input.botId ||
        current.routineId !== input.routineId)
    )
      throw new Error("The trigger changed. Refresh before saving.");
    if (current && current.filter.provider !== input.filter.provider)
      throw new Error("Create a separate trigger for another provider");
    const routine = new WorkspaceRoutines(this.sql)
      .list(input.botId)
      .find((item) => item.id === input.routineId);
    if (routine?.schedule.kind !== "event") throw new Error("Choose an event routine");
    if (!current && this.list(input.routineId).length >= 10)
      throw new Error("A routine can have at most ten event triggers");
    if (!current && input.filter.provider === "slack" && !input.secret)
      throw new Error("Enter the Slack app signing secret");
    const secret =
      input.secret ??
      current?.secret ??
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
    const stamp = now();
    this
      .sql`INSERT INTO event_triggers (id, bot_id, routine_id, name, revision, enabled, filter_json, secret, created_at, updated_at) VALUES (${input.id}, ${input.botId}, ${input.routineId}, ${input.name}, ${(current?.revision ?? 0) + 1}, ${input.enabled ? 1 : 0}, ${JSON.stringify(input.filter)}, ${secret}, ${stamp}, ${stamp}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, revision = excluded.revision, enabled = excluded.enabled, filter_json = excluded.filter_json, secret = excluded.secret, updated_at = excluded.updated_at`;
    const trigger = this.list(input.routineId).find((item) => item.id === input.id);
    if (!trigger) throw new Error("Trigger could not be saved");
    return { trigger, ...(!current || input.secret ? { secret } : {}) };
  }
  remove(id: string) {
    return this.sql`DELETE FROM event_triggers WHERE id = ${id} RETURNING id`.length > 0;
  }
  history(id: string): EventReceipt[] {
    return this
      .sql<Row>`SELECT * FROM event_receipts WHERE trigger_id = ${id} ORDER BY created_at DESC LIMIT 25`.map(
      (row) => ({
        id: text(row, "event_id"),
        state: text(row, "state") as EventReceipt["state"],
        runId: row.run_id === null ? null : text(row, "run_id"),
        createdAt: text(row, "created_at")
      })
    );
  }
  accept(trigger: EventTrigger, event: VerifiedEvent): { state: string; runId?: string } {
    const current = this.read(trigger.id);
    if (!current?.enabled || current.revision !== trigger.revision)
      throw new Error("Trigger is unavailable or changed");
    const existing = this
      .sql<Row>`SELECT * FROM event_receipts WHERE trigger_id = ${trigger.id} AND event_id = ${event.id}`[0];
    if (existing) {
      if (existing.digest !== event.digest)
        throw new Error("Delivery ID was reused with different content");
      return { state: "duplicate" };
    }
    const count =
      this.sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM event_receipts WHERE trigger_id = ${trigger.id}`[0]?.count ??
      0;
    if (count >= 100000)
      throw new Error(
        "Trigger receipt storage is full. Replace this trigger with a new signing secret."
      );
    let runId: string | undefined;
    if (!event.ignored) {
      runId = `event:${trigger.id}:${event.id}`;
      new WorkspaceRoutines(this.sql).queue(
        trigger.botId,
        trigger.routineId,
        runId,
        "event",
        JSON.stringify(event.body)
      );
    }
    const state = event.ignored ? "ignored" : "accepted";
    this
      .sql`INSERT INTO event_receipts (trigger_id, event_id, digest, state, run_id, created_at) VALUES (${trigger.id}, ${event.id}, ${event.digest}, ${state}, ${runId ?? null}, ${now()})`;
    return { state, ...(runId ? { runId } : {}) };
  }
}
