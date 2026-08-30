import { describe, expect, it, vi } from "vitest";

import { MailRealtime, type MailRealtimeHost } from "../../src/workspace/mail-realtime";

type SocketEvent = { data?: unknown };
type SocketListener = (event: SocketEvent) => void;

class TestSocket {
  private readonly listeners = new Map<string, SocketListener[]>();

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: SocketEvent = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close(): void {}
}

describe("mail realtime lifetime", () => {
  it("tracks event work through the Durable Object lifetime", async () => {
    const pending: Promise<void>[] = [];
    const host = {
      waitUntil: (promise: Promise<void>) => pending.push(promise),
      getStoredConnection: () => null,
      saveConnectionState: vi.fn(),
      acceptMessage: vi.fn(async () => undefined),
      queueReconcile: vi.fn(async () => undefined),
      scheduleReconnect: vi.fn(async () => undefined),
      scheduleRenewal: vi.fn(async () => undefined)
    } satisfies MailRealtimeHost;
    const runtime = new MailRealtime("connection-key", host);
    const internals = runtime as unknown as {
      sockets: Map<string, WebSocket>;
      observe(connectionId: string, socket: WebSocket): void;
    };
    const socket = new TestSocket();
    const webSocket = socket as unknown as WebSocket;

    internals.sockets.set("connection", webSocket);
    internals.observe("connection", webSocket);
    socket.emit("message", { data: '{"type":"changed","topic":"messages"}' });
    socket.emit("close");

    expect(host.queueReconcile).toHaveBeenCalledWith("connection");
    expect(host.scheduleReconnect).toHaveBeenCalledWith("connection");
    expect(host.saveConnectionState).toHaveBeenCalledWith("connection", "disconnected");
    expect(pending).toHaveLength(2);
    await Promise.all(pending);
  });
});
