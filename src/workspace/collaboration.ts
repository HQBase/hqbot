import type {
  CollaborationDelivery,
  CollaborationRequest,
  ProjectMessage
} from "../domain/projects";
import { WorkspaceProjects } from "./projects";
import { now, type Row, text } from "./sql";

export class WorkspaceCollaboration extends WorkspaceProjects {
  messages(projectId: string, botId?: string, before?: string): ProjectMessage[] {
    this.assertMember(projectId, botId);
    return this
      .sql<Row>`SELECT * FROM project_messages WHERE project_id = ${projectId} AND (${before ?? null} IS NULL OR created_at || ':' || id < ${before ?? ""}) ORDER BY created_at DESC, id DESC LIMIT 100`
      .map((row) => ({
        id: text(row, "id"),
        projectId,
        senderBotId: row.sender_bot_id === null ? null : text(row, "sender_bot_id"),
        content: text(row, "content"),
        parentId: row.parent_id === null ? null : text(row, "parent_id"),
        createdAt: text(row, "created_at")
      }))
      .reverse();
  }
  send(senderBotId: string | null, input: CollaborationRequest): ProjectMessage {
    const project = this.assertMember(input.projectId, senderBotId ?? undefined);
    if (!input.id || input.id.length > 200 || !input.content.trim() || input.content.length > 12000)
      throw new Error("A message ID and a message of up to 12000 characters are required");
    if (
      input.recipientIds.length < 1 ||
      input.recipientIds.length > 6 ||
      new Set(input.recipientIds).size !== input.recipientIds.length
    )
      throw new Error("Choose one to six teammates");
    for (const recipient of input.recipientIds)
      if (
        !project.botIds.includes(recipient) ||
        recipient === senderBotId ||
        this.catalog.getBot(recipient)?.hidden
      )
        throw new Error("Choose another active project teammate");
    const existing = this.sql<Row>`SELECT * FROM project_messages WHERE id = ${input.id}`[0];
    if (existing) {
      if (
        existing.project_id !== input.projectId ||
        existing.sender_bot_id !== senderBotId ||
        existing.content !== input.content.trim()
      )
        throw new Error("Message ID is already in use");
      return {
        id: input.id,
        projectId: input.projectId,
        senderBotId,
        content: text(existing, "content"),
        parentId: existing.parent_id === null ? null : text(existing, "parent_id"),
        createdAt: text(existing, "created_at")
      };
    }
    if (
      input.parentId &&
      !this
        .sql<Row>`SELECT id FROM project_messages WHERE id = ${input.parentId} AND project_id = ${input.projectId}`
        .length
    )
      throw new Error("Thread not found");
    const parent =
      input.parentDeliveryId && senderBotId
        ? this.delivery(input.parentDeliveryId, senderBotId)
        : null;
    if (input.parentDeliveryId && (!parent || parent.projectId !== project.id))
      throw new Error("Handoff context is no longer active");
    const depth = parent ? parent.depth + 1 : 0;
    const rootId = parent?.rootId ?? input.id;
    if (depth > 4)
      throw new Error("The handoff limit was reached. Report the result to the owner.");
    const count =
      this.sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM collaboration_deliveries WHERE root_id = ${rootId}`[0]
        ?.count ?? 0;
    if (count + input.recipientIds.length > 20)
      throw new Error("The group work limit was reached. Report progress to the owner.");
    const queued =
      this.sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM collaboration_deliveries WHERE state IN ('pending', 'submitted')`[0]
        ?.count ?? 0;
    if (queued + input.recipientIds.length > 100)
      throw new Error("The work queue is full. Wait for current work to finish.");
    const stamp = now();
    this
      .sql`INSERT INTO project_messages (id, project_id, sender_bot_id, content, parent_id, created_at) VALUES (${input.id}, ${project.id}, ${senderBotId}, ${input.content.trim()}, ${input.parentId ?? null}, ${stamp})`;
    for (const botId of input.recipientIds)
      this
        .sql`INSERT INTO collaboration_deliveries (id, project_id, message_id, bot_id, sender_bot_id, root_id, depth, state, created_at, updated_at) VALUES (${`${input.id}:${botId}`}, ${project.id}, ${input.id}, ${botId}, ${senderBotId}, ${rootId}, ${depth}, 'pending', ${stamp}, ${stamp})`;
    return {
      id: input.id,
      projectId: project.id,
      senderBotId,
      content: input.content.trim(),
      parentId: input.parentId ?? null,
      createdAt: stamp
    };
  }
  delivery(id: string, botId: string): CollaborationDelivery | null {
    const row = this
      .sql<Row>`SELECT d.*, m.content FROM collaboration_deliveries d JOIN project_messages m ON m.id = d.message_id JOIN project_teammates p ON p.project_id = d.project_id AND p.bot_id = d.bot_id WHERE d.id = ${id} AND d.bot_id = ${botId} AND d.state IN ('pending', 'submitted')`[0];
    if (!row || this.catalog.getBot(botId)?.hidden) return null;
    if (
      typeof row.sender_bot_id === "string" &&
      !this.list(row.sender_bot_id).some((project) => project.id === row.project_id)
    )
      return null;
    return {
      id,
      projectId: text(row, "project_id"),
      messageId: text(row, "message_id"),
      botId,
      senderBotId: row.sender_bot_id === null ? null : text(row, "sender_bot_id"),
      rootId: text(row, "root_id"),
      depth: Number(row.depth),
      response: Number(row.response) === 1,
      state: text(row, "state"),
      prompt: text(row, "content"),
      createdAt: text(row, "created_at")
    };
  }
  pending() {
    return this.sql<{
      id: string;
      bot_id: string;
      state: string;
    }>`SELECT id, bot_id, state FROM collaboration_deliveries WHERE state IN ('pending', 'submitted') ORDER BY updated_at, id LIMIT 20`;
  }
  state(id: string, state: string) {
    this
      .sql`UPDATE collaboration_deliveries SET state = ${state}, updated_at = ${now()} WHERE id = ${id} AND state IN ('pending', 'submitted')`;
  }
  finish(id: string, botId: string, content: string, failed = false) {
    const job = this.delivery(id, botId);
    if (!job) return;
    const stamp = now();
    this
      .sql`INSERT OR IGNORE INTO project_messages (id, project_id, sender_bot_id, content, parent_id, created_at) VALUES (${`reply:${id}`}, ${job.projectId}, ${botId}, ${content.slice(0, 12000)}, ${job.messageId}, ${stamp})`;
    this.state(id, failed ? "failed" : "completed");
    if (
      !failed &&
      !job.response &&
      job.senderBotId &&
      job.depth < 4 &&
      this.catalog.getBot(job.senderBotId)?.hidden === false &&
      this.list(job.senderBotId).some((project) => project.id === job.projectId)
    ) {
      const count =
        this.sql<{
          count: number;
        }>`SELECT COUNT(*) AS count FROM collaboration_deliveries WHERE root_id = ${job.rootId}`[0]
          ?.count ?? 0;
      if (count < 20)
        this
          .sql`INSERT OR IGNORE INTO collaboration_deliveries (id, project_id, message_id, bot_id, sender_bot_id, root_id, depth, response, state, created_at, updated_at) VALUES (${`return:${id}`}, ${job.projectId}, ${`reply:${id}`}, ${job.senderBotId}, ${botId}, ${job.rootId}, ${job.depth + 1}, 1, 'pending', ${stamp}, ${stamp})`;
    }
  }
  cancelBot(botId: string) {
    this
      .sql`UPDATE collaboration_deliveries SET state = 'cancelled', updated_at = ${now()} WHERE (bot_id = ${botId} OR sender_bot_id = ${botId}) AND state IN ('pending', 'submitted')`;
  }
  remove(projectId: string) {
    return this.sql`DELETE FROM projects WHERE id = ${projectId} RETURNING id`.length > 0;
  }
}
