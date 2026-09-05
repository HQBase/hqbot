import {
  type Demonstration,
  type DemonstrationInput,
  demonstrationInput
} from "../domain/demonstrations";
import { WorkspaceCatalog } from "./catalog";
import { now, type Row, type Sql, text } from "./sql";

export class WorkspaceDemonstrations {
  constructor(private readonly sql: Sql) {}
  private from(row: Row): Demonstration {
    return {
      id: text(row, "id"),
      botId: text(row, "bot_id"),
      name: text(row, "name"),
      notes: text(row, "notes"),
      videoId: text(row, "video_id"),
      frames: JSON.parse(text(row, "frames_json")) as DemonstrationInput["frames"],
      state: text(row, "state"),
      attempts: Number(row.attempts),
      skillId: row.skill_id === null ? null : text(row, "skill_id"),
      error: row.error === null ? null : text(row, "error"),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at")
    };
  }
  read(id: string) {
    const row = this.sql<Row>`SELECT * FROM demonstrations WHERE id = ${id}`[0];
    return row ? this.from(row) : null;
  }
  list(botId: string) {
    return this
      .sql<Row>`SELECT * FROM demonstrations WHERE bot_id = ${botId} ORDER BY created_at DESC LIMIT 30`.map(
      (row) => this.from(row)
    );
  }
  pending() {
    return this
      .sql<Row>`SELECT * FROM demonstrations WHERE state IN ('queued', 'building') ORDER BY updated_at LIMIT 3`.map(
      (row) => this.from(row)
    );
  }
  save(value: unknown) {
    const input = demonstrationInput.parse(value);
    const existing = this.read(input.id);
    if (existing) {
      if (JSON.stringify(demonstrationInput.parse(existing)) !== JSON.stringify(input))
        throw new Error("Demonstration ID is already in use");
      return existing;
    }
    const catalog = new WorkspaceCatalog(this.sql);
    const bot = catalog.getBot(input.botId);
    if (!bot || bot.hidden) throw new Error("Choose an active teammate");
    if (
      catalog
        .listSkills(input.botId)
        .some((skill) => skill.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())
    )
      throw new Error("A skill with this name exists. Choose a different name for this draft.");
    const video = catalog.getFile(input.videoId, input.botId);
    if (!video || !["video/webm", "video/mp4"].includes(video.contentType) || video.size > 10000000)
      throw new Error("Choose a saved video recording up to 10 MB");
    for (const frame of input.frames) {
      const file = catalog.getFile(frame.fileId, input.botId);
      if (!file || !["image/jpeg", "image/png"].includes(file.contentType) || file.size > 500000)
        throw new Error("Each selected frame must be an image up to 500 KB owned by this teammate");
    }
    if (
      (this.sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM demonstrations WHERE bot_id = ${input.botId} AND state IN ('queued', 'building')`[0]
        ?.count ?? 0) >= 3
    )
      throw new Error("Wait for a draft to finish before adding another");
    const stamp = now();
    this
      .sql`INSERT INTO demonstrations (id, bot_id, name, notes, video_id, frames_json, state, created_at, updated_at) VALUES (${input.id}, ${input.botId}, ${input.name}, ${input.notes}, ${input.videoId}, ${JSON.stringify(input.frames)}, 'queued', ${stamp}, ${stamp})`;
    return this.read(input.id);
  }
  claim(id: string) {
    this
      .sql`UPDATE demonstrations SET attempts = attempts + 1, state = 'building', updated_at = ${now()} WHERE id = ${id} AND state IN ('queued', 'building')`;
  }
  finish(id: string, skillId: string) {
    this
      .sql`UPDATE demonstrations SET state = 'ready', skill_id = ${skillId}, error = NULL, updated_at = ${now()} WHERE id = ${id} AND state IN ('queued', 'building')`;
  }
  fail(id: string, retry: boolean) {
    this
      .sql`UPDATE demonstrations SET state = ${retry ? "queued" : "failed"}, error = 'The draft could not be generated. Check the teammate budget and source files, then try again.', updated_at = ${now()} WHERE id = ${id} AND state IN ('queued', 'building')`;
  }
  retry(id: string, botId: string) {
    this
      .sql`UPDATE demonstrations SET state = 'queued', attempts = 0, error = NULL, updated_at = ${now()} WHERE id = ${id} AND bot_id = ${botId} AND state = 'failed'`;
  }
  cancel(botId: string) {
    this
      .sql`UPDATE demonstrations SET state = 'cancelled', updated_at = ${now()} WHERE bot_id = ${botId} AND state IN ('queued', 'building')`;
  }
}
