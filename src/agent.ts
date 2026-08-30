import { getAgentByName } from "agents";

import type { BotConnection, BotTeammate, StoredBotConnection } from "./domain/types";
import { STALE_REPLY_APPROVAL_ERROR } from "./runtime/approval";
import type {
  SendApprovedReplyInput,
  SendApprovedReplyResult,
  TeammateTaskSubmission
} from "./runtime/types";
import { decryptConnectionToken } from "./services/crypto";
import {
  emailTaskPrompt,
  existingReply,
  getMessage,
  getThread,
  type MailConfig,
  type MessageSummary,
  replyToMessage,
  stableMailTaskId
} from "./services/mail";
import type { HQBotTeammate } from "./teammate";
import { WorkspaceAgentBase } from "./workspace/agent-base";
import type { WorkspaceCatalog } from "./workspace/catalog";
import { MailRealtime, type MailRealtimeHost } from "./workspace/mail-realtime";

export class HQBotAgent extends WorkspaceAgentBase implements MailRealtimeHost {
  private mailRuntime: MailRealtime | null = null;

  private get mail(): MailRealtime {
    this.mailRuntime ??= new MailRealtime(this.env.HQBOT_CONNECTION_KEY, this);
    return this.mailRuntime;
  }

  async onStart(): Promise<void> {
    await super.onStart();
    this.ctx.waitUntil(
      Promise.all(
        this.catalog.listActiveConnections().map((connection) => this.mail.connect(connection.id))
      ).then(() => undefined)
    );
  }

  waitUntil(promise: Promise<void>): void {
    this.ctx.waitUntil(promise);
  }

  connectHQBase(input: Parameters<WorkspaceCatalog["connectHQBase"]>[0]): BotConnection {
    const connection = this.catalog.connectHQBase(input);
    this.ctx.waitUntil(this.queue("openConnection", { connectionId: connection.id }));
    this.changed();
    return connection;
  }

  getBotConnection(id: string): StoredBotConnection | null {
    return (
      this.catalog.getBotConnection(id) ??
      this.catalog.listActiveConnections().find((connection) => connection.botId === id) ??
      null
    );
  }

  listActiveConnections(): StoredBotConnection[] {
    return this.catalog.listActiveConnections();
  }

  disconnectHQBase(botId: string): boolean {
    const connection = this.getBotConnection(botId);
    const deleted = this.catalog.disconnectHQBase(botId);
    if (connection) this.mail.close(connection.id);
    if (deleted) this.changed();
    return deleted;
  }

  async setBotHidden(id: string, hidden: boolean): Promise<BotTeammate | null> {
    const current = this.catalog.getBot(id);
    if (!current || current.hidden === hidden) return current;
    const connection = hidden ? this.getBotConnection(id) : null;
    const updated = hidden
      ? this.catalog.archiveBot(id)
      : this.catalog.updateBot(id, { hidden: false });
    if (!updated || !hidden) {
      if (updated) this.changed();
      return updated;
    }

    if (connection) this.mail.close(connection.id);
    const cancelledTaskIds = this.tasks
      .listTasks(id)
      .filter((task) => this.tasks.cancelTask(task.id))
      .map((task) => task.id);
    const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, id);
    await peer.suspend(cancelledTaskIds);
    this.changed();
    return this.catalog.getBot(id);
  }

  async stopBot(id: string): Promise<boolean> {
    const bot = this.catalog.getBot(id);
    if (!bot) return false;
    const taskIds = this.tasks.cancelBotTasks(id);
    const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, id);
    await peer.stopActivity(taskIds);
    this.catalog.markInteraction(id, "Activity stopped", "idle");
    this.changed();
    return true;
  }

  async deleteBot(id: string): Promise<boolean> {
    const bot = this.catalog.getBot(id);
    if (!bot) return false;
    const connection = this.getBotConnection(id);
    const artifactKeys = this.catalog.listBotArtifactKeys(id);
    this.catalog.archiveBot(id);
    if (connection) this.mail.close(connection.id);

    const taskIds = this.tasks.cancelBotTasks(id);
    const peer = await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, id);
    await peer.stopActivity(taskIds, "The owner deleted this teammate");
    await this.deleteArtifactPrefix(`files/${id}/`);
    await this.deleteArtifactPrefix(`teammates/${id}/`);
    for (let index = 0; index < artifactKeys.length; index += 1_000) {
      await this.env.ARTIFACTS.delete(artifactKeys.slice(index, index + 1_000));
    }
    await peer.destroySoon();

    const deleted = this.catalog.deleteBot(id);
    if (deleted) this.changed();
    return deleted;
  }

  private async deleteArtifactPrefix(prefix: string): Promise<void> {
    for (;;) {
      const page = await this.env.ARTIFACTS.list({ limit: 1_000, prefix });
      if (page.objects.length === 0) return;
      await this.env.ARTIFACTS.delete(page.objects.map((object) => object.key));
      if (!page.truncated) return;
    }
  }

  getStoredConnection(id: string): StoredBotConnection | null {
    return this.catalog.getBotConnection(id);
  }

  saveConnectionState(
    id: string,
    status: StoredBotConnection["realtimeStatus"],
    cursor?: string | null
  ): void {
    this.catalog.setConnectionRealtime(id, status, cursor);
    this.changed();
  }

  async acceptMessage(connection: StoredBotConnection, message: MessageSummary): Promise<void> {
    const taskId = await stableMailTaskId(connection, message.id);
    const source = await getMessage(await this.mailConfig(connection), message.id);
    const body = source.textBody.trim() || message.snippet.trim() || message.subject.trim();
    const prompt = emailTaskPrompt(message, body);
    const created = this.tasks.createEmailTask({
      id: taskId,
      botId: connection.botId,
      connectionId: connection.id,
      messageId: message.id,
      sender: message.fromAddress,
      subject: message.subject,
      prompt
    });
    if (!created) {
      const existing = this.tasks.getTask(taskId);
      if (existing?.status !== "queued" || existing.submissionId) return;
    } else {
      this.catalog.markInteraction(connection.botId, message.subject || message.snippet, "working");
    }
    const teammate = await getAgentByName<Env, HQBotTeammate>(
      this.env.HQBOT_TEAMMATE,
      connection.botId
    );
    const submission = await teammate.submitTask({
      taskId,
      source: "email",
      prompt
    } satisfies TeammateTaskSubmission);
    this.tasks.setSubmission(taskId, submission.submissionId);
    this.changed();
  }

  async queueReconcile(connectionId: string): Promise<void> {
    await this.queue("reconcileConnection", { connectionId });
  }

  async scheduleReconnect(connectionId: string): Promise<void> {
    await this.schedule(15, "openConnection", { connectionId }, { idempotent: true });
  }

  async scheduleRenewal(connectionId: string): Promise<void> {
    await this.schedule(8 * 60, "renewConnection", { connectionId }, { idempotent: true });
  }

  async openConnection(payload: { connectionId: string }): Promise<void> {
    await this.mail.connect(payload.connectionId);
  }

  async renewConnection(payload: { connectionId: string }): Promise<void> {
    await this.mail.renew(payload.connectionId);
  }

  async reconcileConnection(payload: { connectionId: string }): Promise<void> {
    await this.mail.drain(payload.connectionId);
  }

  async sendApprovedReply(input: SendApprovedReplyInput): Promise<SendApprovedReplyResult> {
    const task = this.tasks.getTask(input.taskId);
    if (!task || task.botId !== input.botId || task.source !== "email" || !task.connectionId) {
      throw new Error("The HQBase email task is not available");
    }
    if (task.replyMessageId) return { messageId: task.replyMessageId, duplicate: true };
    if (task.status !== "replying" || task.result !== input.draft) {
      throw new Error(STALE_REPLY_APPROVAL_ERROR);
    }
    if (!task.sourceMessageId) throw new Error("The source email is not available");
    const connection = this.catalog.getBotConnection(task.connectionId);
    if (!connection?.active) throw new Error("The HQBase connection is not active");
    const config = await this.mailConfig(connection);
    const source = await getMessage(config, task.sourceMessageId);
    const duplicate = existingReply(
      await getThread(config, source.id),
      source,
      connection.mailboxAddress
    );
    if (duplicate) {
      this.completeTask(task.id, input.draft, duplicate.id);
      return { messageId: duplicate.id, duplicate: true };
    }
    const reply = await replyToMessage(config, source.id, input.draft);
    this.completeTask(task.id, input.draft, reply.id);
    return { messageId: reply.id, duplicate: false };
  }

  private async mailConfig(connection: StoredBotConnection): Promise<MailConfig> {
    return {
      origin: connection.origin,
      mailboxId: connection.mailboxId,
      mailboxAddress: connection.mailboxAddress,
      token: await decryptConnectionToken(
        this.env.HQBOT_CONNECTION_KEY,
        connection.tokenCiphertext,
        connection.tokenIv
      )
    };
  }
}
