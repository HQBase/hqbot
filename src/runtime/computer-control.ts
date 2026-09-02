export interface ComputerControlLease {
  expiresAt: number;
  scheduleId: string;
  state: "active" | "revoking";
  token: string;
}

const CONTROL_STOP_RETRY_MS = 30_000;

interface ControlStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface ComputerControlOptions {
  cancelSchedule: (id: string) => Promise<boolean>;
  key: string;
  schedule: (when: Date, payload: { stop: true; token: string }) => Promise<{ id: string }>;
  storage: ControlStorage;
}

export class ComputerControlManager {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: ComputerControlOptions) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  read(): Promise<ComputerControlLease | null> {
    return readComputerControlLease(this.options.storage, this.options.key);
  }

  async retryStop(lease: ComputerControlLease): Promise<void> {
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + CONTROL_STOP_RETRY_MS;
    const schedule = await this.options.schedule(new Date(expiresAt), { stop: true, token });
    try {
      await this.options.storage.put(this.options.key, {
        ...lease,
        expiresAt,
        scheduleId: schedule.id,
        token
      });
    } catch (cause) {
      await this.options.cancelSchedule(schedule.id).catch(() => false);
      throw cause;
    }
  }
}

export async function readComputerControlLease(
  storage: ControlStorage,
  key: string
): Promise<ComputerControlLease | null> {
  const value = await storage.get<unknown>(key);
  if (value === undefined || value === null) return null;
  let lease: ComputerControlLease;
  if (typeof value === "number" && value > 0) {
    lease = { expiresAt: value, scheduleId: "", state: "revoking", token: crypto.randomUUID() };
  } else if (
    typeof value === "object" &&
    typeof (value as ComputerControlLease).expiresAt === "number" &&
    typeof (value as ComputerControlLease).scheduleId === "string" &&
    typeof (value as ComputerControlLease).token === "string"
  ) {
    const stored = value as ComputerControlLease;
    lease = {
      ...stored,
      state: stored.state === undefined || stored.state === "active" ? "active" : "revoking"
    };
  } else {
    lease = { expiresAt: 0, scheduleId: "", state: "revoking", token: crypto.randomUUID() };
  }
  if ((value as ComputerControlLease).state !== lease.state) await storage.put(key, lease);
  return lease;
}
