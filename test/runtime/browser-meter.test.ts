import type { BrowserSessionLock, BrowserSessionStore, StoredBrowserSession } from "agents/browser";
import { describe, expect, it, vi } from "vitest";

import { MeteredBrowserSessionStore, meteredBrowserBinding } from "../../src/runtime/browser-meter";

class MemorySessionStore implements BrowserSessionStore {
  readonly sessions = new Map<string, StoredBrowserSession>();

  acquireLock(): BrowserSessionLock {
    return { release: () => undefined };
  }

  get(key: string): StoredBrowserSession | undefined {
    return this.sessions.get(key);
  }

  set(key: string, session: StoredBrowserSession): void {
    this.sessions.set(key, session);
  }

  delete(key: string): void {
    this.sessions.delete(key);
  }

  list(prefix: string): Map<string, StoredBrowserSession> {
    return new Map([...this.sessions].filter(([key]) => key.startsWith(prefix)));
  }
}

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>({ prefix }: { prefix: string }): Promise<Map<string, T>> {
    return new Map(
      [...this.values]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, value as T])
    );
  }
}

describe("Browser Run metering", () => {
  it("uses Cloudflare's exact Quick Action browser time", async () => {
    const record = vi.fn();
    const browser = meteredBrowserBinding(
      {
        fetch: vi.fn(),
        quickAction: vi.fn().mockResolvedValue(
          new Response("{}", {
            headers: { "X-Browser-Ms-Used": "4321" },
            status: 200
          })
        )
      },
      () => "task-1",
      record,
      () => "request-1"
    );

    await browser.quickAction("markdown", { url: "https://example.com" });

    expect(record).toHaveBeenCalledWith({
      eventId: "browser-quick:request-1",
      milliseconds: 4321,
      taskId: "task-1"
    });
  });

  it("counts one reusable session through an explicit Live View close", async () => {
    let now = 1_000;
    const delegate = new MemorySessionStore();
    const record = vi.fn();
    const meter = new MeteredBrowserSessionStore(
      delegate,
      new MemoryStorage(),
      () => "task-1",
      record,
      120_000,
      () => now
    );
    await meter.set("cdp:reuse", {
      createdAt: now,
      sessionId: "session-1",
      updatedAt: now
    });

    now = 6_000;
    expect(await meter.touch("task-1")).toEqual([{ deadline: 126_000, sessionId: "session-1" }]);
    now = 10_000;
    await meter.closeSession(() => meter.delete("cdp:reuse"));

    expect(record.mock.calls.map(([sample]) => sample.milliseconds)).toEqual([5_000, 4_000]);
    expect(record.mock.calls.map(([sample]) => sample.eventId)).toEqual([
      "browser-session:session-1:1000:6000",
      "browser-session:session-1:6000:10000"
    ]);
  });

  it("charges the idle tail only through the keep-alive deadline", async () => {
    let now = 0;
    const delegate = new MemorySessionStore();
    const record = vi.fn();
    const meter = new MeteredBrowserSessionStore(
      delegate,
      new MemoryStorage(),
      () => "task-1",
      record,
      120_000,
      () => now
    );
    await meter.set("cdp:reuse", { createdAt: 0, sessionId: "session-1", updatedAt: 0 });
    now = 5_000;
    await meter.touch("task-1");

    now = 200_000;
    await meter.delete("cdp:reuse");
    await meter.flush();

    expect(record.mock.calls.map(([sample]) => sample.milliseconds)).toEqual([5_000, 120_000]);
  });
});
