import { z } from "zod";
import {
  type Discussion,
  type MessageSource,
  messageSource,
  reactionInput,
  type SearchHit
} from "../domain/messages";
import { now, type Row, type Sql, text } from "./sql";

export class WorkspaceMessages {
  constructor(private readonly sql: Sql) {}
  private key(source: MessageSource) {
    const parsed = messageSource.parse(source);
    return JSON.stringify([parsed.kind, parsed.id, parsed.messageId]);
  }
  private ensure(source: MessageSource) {
    const id = this.key(source);
    this
      .sql`INSERT OR IGNORE INTO message_discussions (id, kind, source_id, message_id, bot_id, project_id) VALUES (${id}, ${source.kind}, ${source.id}, ${source.messageId}, ${source.kind === "bot" ? source.id : null}, ${source.kind === "project" ? source.id : null})`;
    return id;
  }
  read(source: MessageSource, userId: string): Discussion {
    const id = this.key(source);
    return {
      notes: this
        .sql<Row>`SELECT * FROM discussion_notes WHERE discussion_id = ${id} ORDER BY created_at, id LIMIT 100`.map(
        (row) => ({
          id: text(row, "id"),
          userId: text(row, "user_id"),
          content: text(row, "content"),
          createdAt: text(row, "created_at")
        })
      ),
      reactions: this.sql<{
        emoji: string;
        count: number;
        mine: number;
      }>`SELECT emoji, COUNT(*) AS count, MAX(CASE WHEN user_id = ${userId} THEN 1 ELSE 0 END) AS mine FROM message_reactions WHERE discussion_id = ${id} GROUP BY emoji`.map(
        (row) => ({ ...row, mine: Number(row.mine) === 1 })
      )
    };
  }
  react(source: MessageSource, userId: string, value: unknown) {
    const input = reactionInput.parse(value);
    const id = this.ensure(source);
    if (input.active)
      this
        .sql`INSERT OR IGNORE INTO message_reactions (discussion_id, user_id, emoji) VALUES (${id}, ${userId}, ${input.emoji})`;
    else
      this
        .sql`DELETE FROM message_reactions WHERE discussion_id = ${id} AND user_id = ${userId} AND emoji = ${input.emoji}`;
    return this.read(source, userId);
  }
  addNote(source: MessageSource, userId: string, value: unknown) {
    const input = z
      .object({ id: z.uuid(), content: z.string().trim().min(1).max(4000) })
      .parse(value);
    const id = this.ensure(source);
    const existing = this.sql<Row>`SELECT * FROM discussion_notes WHERE id = ${input.id}`[0];
    if (
      existing &&
      (existing.discussion_id !== id ||
        existing.user_id !== userId ||
        existing.content !== input.content)
    )
      throw new Error("Note ID is already in use");
    if (!existing && this.read(source, userId).notes.length >= 100)
      throw new Error("This discussion has reached its 100-note limit");
    this
      .sql`INSERT OR IGNORE INTO discussion_notes (id, discussion_id, user_id, content, created_at) VALUES (${input.id}, ${id}, ${userId}, ${input.content}, ${now()})`;
    return this.read(source, userId);
  }
  search(query: string): SearchHit[] {
    const q = query.trim().slice(0, 200);
    if (!q) return [];
    const rows = this
      .sql<Row>`SELECT m.id, 'project' AS kind, p.name AS label, m.content AS content, NULL AS bot_id, p.id AS project_id, m.created_at FROM project_messages m JOIN projects p ON p.id = m.project_id WHERE instr(lower(m.content), lower(${q})) > 0
      UNION ALL SELECT f.id, 'file', f.name, f.name, f.bot_id, NULL, f.created_at FROM files f WHERE instr(lower(f.name), lower(${q})) > 0
      UNION ALL SELECT s.id, 'skill', s.name, s.instructions, s.bot_id, NULL, s.created_at FROM skills s WHERE instr(lower(s.name || ' ' || s.description || ' ' || s.instructions), lower(${q})) > 0
      UNION ALL SELECT m.id, 'memory', b.name, m.content, m.bot_id, NULL, m.created_at FROM memories m JOIN bots b ON b.id = m.bot_id WHERE instr(lower(m.content), lower(${q})) > 0 ORDER BY created_at DESC LIMIT 100`;
    return rows.map((row) => ({
      id: text(row, "id"),
      kind: text(row, "kind") as SearchHit["kind"],
      label: text(row, "label"),
      text: text(row, "content").slice(0, 12000),
      botId: row.bot_id ? text(row, "bot_id") : undefined,
      projectId: row.project_id ? text(row, "project_id") : undefined,
      createdAt: text(row, "created_at")
    }));
  }
}
