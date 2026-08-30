import type { StoredBotConnection } from "../domain/types";
import { decryptConnectionToken } from "../services/crypto";
import {
  isNewInboundMessage,
  isRelevantInboundChange,
  listChanges,
  listInbox,
  type MailConfig,
  type MessageSummary,
  openMailEvents,
  parseMailEvent
} from "../services/mail";

export interface MailRealtimeHost {
  waitUntil(promise: Promise<void>): void;
  getStoredConnection(id: string): StoredBotConnection | null;
  saveConnectionState(
    id: string,
    status: StoredBotConnection["realtimeStatus"],
    cursor?: string | null
  ): void;
  acceptMessage(connection: StoredBotConnection, message: MessageSummary): Promise<void>;
  queueReconcile(connectionId: string): Promise<void>;
  scheduleReconnect(connectionId: string): Promise<void>;
  scheduleRenewal(connectionId: string): Promise<void>;
}

export class MailRealtime {
  private readonly sockets = new Map<string, WebSocket>();

  constructor(
    private readonly connectionKey: string,
    private readonly host: MailRealtimeHost
  ) {}

  async connect(connectionId: string): Promise<void> {
    const currentSocket = this.sockets.get(connectionId);
    if (currentSocket?.readyState === WebSocket.OPEN) return;
    const connection = this.host.getStoredConnection(connectionId);
    if (!connection?.active) return;

    this.host.saveConnectionState(connectionId, "connecting");
    try {
      const config = await this.config(connection);
      let cursor = connection.changeCursor;
      if (!cursor) {
        const checkpoint = await listChanges(config);
        cursor = checkpoint.nextCursor;
        this.host.saveConnectionState(connection.id, "connecting", cursor);
        for (const message of await listInbox(config)) {
          if (isNewInboundMessage(message, connection.createdAt)) {
            await this.host.acceptMessage(connection, message);
          }
        }
      }

      const socket = await openMailEvents(config);
      this.sockets.set(connectionId, socket);
      this.host.saveConnectionState(connectionId, "connected", cursor);
      this.observe(connectionId, socket);
      await this.drain(connectionId);
      await this.host.scheduleRenewal(connectionId);
    } catch {
      this.host.saveConnectionState(connectionId, "disconnected");
      await this.host.scheduleReconnect(connectionId);
    }
  }

  async drain(connectionId: string): Promise<void> {
    const connection = this.host.getStoredConnection(connectionId);
    if (!connection?.active) return;
    const config = await this.config(connection);
    let cursor = connection.changeCursor;
    if (!cursor) {
      await this.connect(connectionId);
      return;
    }

    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = await listChanges(config, cursor);
      for (const change of page.changes) {
        if (isRelevantInboundChange(change, connection.mailboxId, connection.createdAt)) {
          await this.host.acceptMessage(connection, change.message);
        }
      }
      cursor = page.nextCursor;
      this.host.saveConnectionState(connectionId, "connected", cursor);
      if (!page.hasMore) return;
    }
    await this.host.queueReconcile(connectionId);
  }

  async renew(connectionId: string): Promise<void> {
    const socket = this.sockets.get(connectionId);
    if (socket) {
      this.sockets.delete(connectionId);
      socket.close(1000, "Renew HQBase authorization");
    }
    await this.connect(connectionId);
  }

  close(connectionId: string): void {
    const socket = this.sockets.get(connectionId);
    this.sockets.delete(connectionId);
    socket?.close(1000, "HQBase connection removed");
  }

  private async config(connection: StoredBotConnection): Promise<MailConfig> {
    return {
      origin: connection.origin,
      mailboxId: connection.mailboxId,
      mailboxAddress: connection.mailboxAddress,
      token: await decryptConnectionToken(
        this.connectionKey,
        connection.tokenCiphertext,
        connection.tokenIv
      )
    };
  }

  private observe(connectionId: string, socket: WebSocket): void {
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = parseMailEvent(event.data);
      if (message?.topic === "messages" || message?.topic === "mailboxes") {
        this.host.waitUntil(this.host.queueReconcile(connectionId));
      }
    });
    socket.addEventListener("close", () => {
      if (this.sockets.get(connectionId) !== socket) return;
      this.sockets.delete(connectionId);
      this.host.saveConnectionState(connectionId, "disconnected");
      this.host.waitUntil(this.host.scheduleReconnect(connectionId));
    });
    socket.addEventListener("error", () => socket.close(1011, "HQBase event connection failed"));
  }
}
