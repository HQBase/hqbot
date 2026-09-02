import { COMPUTER_IDLE_SECONDS, estimateComputerMicroUsd } from "./desktop";
import type { WorkspaceAgentRpc } from "./types";

export const COMPUTER_LEASE_KEY = "hqbot:computer:lease";
const BILLED_THROUGH_KEY = "hqbot:computer:billed-through";

export interface ComputerLease {
  expiresAt: number;
  scheduleId: string;
  token: string;
}

interface LeaseStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface ComputerLeaseOptions {
  botId: string;
  cancelSchedule: (id: string) => Promise<boolean>;
  schedule: (when: Date, payload: { token: string }) => Promise<{ id: string }>;
  storage: LeaseStorage;
  workspaceAgent: WorkspaceAgentRpc;
}

export class ComputerLeaseManager {
  constructor(private readonly options: ComputerLeaseOptions) {}

  async touch(input: { eventId: string; taskId: string | null }): Promise<void> {
    const target = Date.now() + COMPUTER_IDLE_SECONDS * 1_000;
    await this.reserve(target, input.taskId, input.eventId);
    await this.arm();
  }

  async arm(): Promise<void> {
    const previous = await this.options.storage.get<ComputerLease>(COMPUTER_LEASE_KEY);
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + COMPUTER_IDLE_SECONDS * 1_000;
    const schedule = await this.options.schedule(new Date(expiresAt), { token });
    await this.options.storage.put<ComputerLease>(COMPUTER_LEASE_KEY, {
      expiresAt,
      scheduleId: schedule.id,
      token
    });
    if (previous) await this.options.cancelSchedule(previous.scheduleId).catch(() => false);
  }

  private async reserve(target: number, taskId: string | null, source: string): Promise<void> {
    const now = Date.now();
    const prior = (await this.options.storage.get<number>(BILLED_THROUGH_KEY)) ?? now;
    const start = Math.max(now, prior);
    const seconds = Math.max(0, Math.ceil((target - start) / 1_000));
    if (seconds === 0) return;
    const policy = await this.options.workspaceAgent.checkSpendPolicy(this.options.botId, taskId);
    if (!policy.allowed) throw new Error(policy.reason ?? "The cost budget was reached");
    await this.options.workspaceAgent.recordResourceUsage({
      eventId: `computer:${this.options.botId}:${source}:${start}:${target}`,
      botId: this.options.botId,
      taskId,
      service: "sandbox",
      units: seconds,
      estimatedCostMicroUsd: estimateComputerMicroUsd(seconds)
    });
    await this.options.storage.put(BILLED_THROUGH_KEY, target);
  }
}
