import type { BotRoutine } from "../domain/types";
import { now, type Row, routineFromRow, type Sql } from "./sql";

export class WorkspaceAutomations {
  constructor(private readonly sql: Sql) {}

  createRoutine(input: {
    id: string;
    botId: string;
    name: string;
    prompt: string;
    intervalMinutes: number;
    nextRunAt: string;
  }): BotRoutine {
    const timestamp = now();
    this.sql`INSERT INTO routines (
      id, bot_id, name, prompt, interval_minutes, active, next_run_at, created_at, updated_at
    ) VALUES (
      ${input.id}, ${input.botId}, ${input.name}, ${input.prompt}, ${input.intervalMinutes}, 1,
      ${input.nextRunAt}, ${timestamp}, ${timestamp}
    )`;
    return { ...input, active: true, createdAt: timestamp, updatedAt: timestamp };
  }

  listRoutines(botId: string): BotRoutine[] {
    return this.sql<Row>`SELECT * FROM routines WHERE bot_id = ${botId}
      ORDER BY created_at ASC`.map(routineFromRow);
  }

  setRoutineActive(id: string, botId: string, active: boolean): BotRoutine | null {
    this.sql`UPDATE routines SET active = ${active ? 1 : 0}, updated_at = ${now()}
      WHERE id = ${id} AND bot_id = ${botId}`;
    const row = this.sql<Row>`SELECT * FROM routines WHERE id = ${id} AND bot_id = ${botId}`[0];
    return row ? routineFromRow(row) : null;
  }

  pauseBotRoutines(botId: string): number {
    return this.sql<{ id: string }>`UPDATE routines SET active = 0, updated_at = ${now()}
      WHERE bot_id = ${botId} AND active = 1 RETURNING id`.length;
  }

  deleteRoutine(id: string, botId: string): boolean {
    return (
      this.sql<{ id: string }>`DELETE FROM routines WHERE id = ${id} AND bot_id = ${botId}
        RETURNING id`.length > 0
    );
  }
}
