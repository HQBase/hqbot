import type {
  BrowserBinding,
  BrowserSessionLock,
  BrowserSessionStore,
  QuickActionBinding,
  StoredBrowserSession
} from "agents/browser";

const METER_PREFIX = "hqbot:browser-meter:";
const OUTBOX_PREFIX = "hqbot:browser-usage:";

export interface BrowserUsageSample {
  eventId: string;
  taskId: string | null;
  milliseconds: number;
}

interface MeterState {
  storeKey: string;
  sessionId: string;
  billedThrough: number;
  lastActivityAt: number;
  taskId: string | null;
}

export interface BrowserSessionLease {
  sessionId: string;
  deadline: number;
}

interface MeterStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

export class MeteredBrowserSessionStore implements BrowserSessionStore {
  private explicitCloseAt: number | null = null;

  constructor(
    private readonly delegate: BrowserSessionStore,
    private readonly storage: MeterStorage,
    private readonly taskId: () => string | null,
    private readonly record: (sample: BrowserUsageSample) => Promise<void>,
    private readonly keepAliveMs: number,
    private readonly now: () => number = Date.now
  ) {}

  acquireLock(key: string): BrowserSessionLock | Promise<BrowserSessionLock> {
    return this.delegate.acquireLock(key);
  }

  get(key: string): StoredBrowserSession | undefined | Promise<StoredBrowserSession | undefined> {
    return this.delegate.get(key);
  }

  async set(key: string, session: StoredBrowserSession): Promise<void> {
    const stateKey = this.stateKey(key);
    const previous = await this.storage.get<MeterState>(stateKey);
    if (previous && previous.sessionId !== session.sessionId) {
      await this.billUntil(
        stateKey,
        previous,
        Math.min(this.now(), previous.lastActivityAt + this.keepAliveMs),
        previous.taskId
      );
      await this.storage.delete(stateKey);
    }

    await this.delegate.set(key, session);
    const currentTaskId = this.taskId();
    await this.storage.put<MeterState>(stateKey, {
      storeKey: key,
      sessionId: session.sessionId,
      billedThrough:
        previous?.sessionId === session.sessionId ? previous.billedThrough : session.createdAt,
      lastActivityAt: session.updatedAt,
      taskId: currentTaskId ?? previous?.taskId ?? null
    });
  }

  async delete(key: string): Promise<void> {
    const session = await this.delegate.get(key);
    const stateKey = this.stateKey(key);
    const state = await this.storage.get<MeterState>(stateKey);
    if (session && state?.sessionId === session.sessionId) {
      const lastActivityAt = Math.max(state.lastActivityAt, session.updatedAt);
      const endedAt =
        this.explicitCloseAt ?? Math.min(this.now(), lastActivityAt + this.keepAliveMs);
      await this.billUntil(stateKey, state, endedAt, this.taskId() ?? state.taskId);
    }
    await this.delegate.delete(key);
    await this.storage.delete(stateKey);
  }

  list(prefix: string): Promise<Map<string, StoredBrowserSession>> {
    return Promise.resolve(this.delegate.list?.(prefix) ?? new Map());
  }

  async touch(taskId: string | null, sessionId?: string): Promise<BrowserSessionLease[]> {
    const states = await this.storage.list<MeterState>({ prefix: METER_PREFIX });
    for (const [stateKey, state] of states) {
      if (sessionId && state.sessionId !== sessionId) continue;
      const lock = await this.delegate.acquireLock(state.storeKey);
      try {
        const session = await this.delegate.get(state.storeKey);
        if (!session || session.sessionId !== state.sessionId) continue;
        await this.set(state.storeKey, { ...session, updatedAt: this.now() });
      } finally {
        await lock.release();
      }
      const current = await this.storage.get<MeterState>(stateKey);
      if (current) await this.billUntil(stateKey, current, this.now(), taskId ?? current.taskId);
    }
    await this.flush();
    return this.leases(sessionId);
  }

  async closeSession(close: () => Promise<void>): Promise<void> {
    this.explicitCloseAt = this.now();
    try {
      await close();
    } finally {
      this.explicitCloseAt = null;
      await this.flush();
    }
  }

  async leases(sessionId?: string): Promise<BrowserSessionLease[]> {
    const states = await this.storage.list<MeterState>({ prefix: METER_PREFIX });
    return [...states.values()]
      .filter((state) => !sessionId || state.sessionId === sessionId)
      .map((state) => ({
        sessionId: state.sessionId,
        deadline: state.lastActivityAt + this.keepAliveMs
      }));
  }

  async flush(): Promise<void> {
    const samples = await this.storage.list<BrowserUsageSample>({ prefix: OUTBOX_PREFIX });
    for (const [key, sample] of samples) {
      await this.record(sample);
      await this.storage.delete(key);
    }
  }

  private async billUntil(
    stateKey: string,
    stored: MeterState,
    endedAt: number,
    taskId: string | null
  ): Promise<MeterState> {
    const billedThrough = Math.max(stored.billedThrough, Math.min(endedAt, this.now()));
    if (billedThrough <= stored.billedThrough) {
      const unchanged = { ...stored, taskId };
      await this.storage.put(stateKey, unchanged);
      return unchanged;
    }

    const sample: BrowserUsageSample = {
      eventId: `browser-session:${stored.sessionId}:${stored.billedThrough}:${billedThrough}`,
      taskId,
      milliseconds: billedThrough - stored.billedThrough
    };
    await this.storage.put(`${OUTBOX_PREFIX}${sample.eventId}`, sample);
    const billed = { ...stored, billedThrough, taskId };
    await this.storage.put(stateKey, billed);
    return billed;
  }

  private stateKey(storeKey: string): string {
    return `${METER_PREFIX}${storeKey}`;
  }
}

export function meteredBrowserBinding(
  browser: BrowserBinding & QuickActionBinding,
  taskId: () => string | null,
  record: (sample: BrowserUsageSample) => Promise<void>,
  eventId: () => string = crypto.randomUUID
): BrowserBinding & QuickActionBinding {
  return {
    fetch: (input, init) => browser.fetch(input, init),
    quickAction: async (action, options) => {
      const response = await browser.quickAction(action, options);
      const milliseconds = Number(response.headers.get("X-Browser-Ms-Used"));
      if (response.ok && Number.isFinite(milliseconds) && milliseconds > 0) {
        await record({
          eventId: `browser-quick:${eventId()}`,
          taskId: taskId(),
          milliseconds
        });
      }
      return response;
    }
  };
}

export function estimateBrowserMicroUsd(milliseconds: number): number {
  return Math.round((milliseconds / 3_600_000) * 0.09 * 1_000_000);
}
