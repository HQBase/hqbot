import type { ComputerResources } from "./desktop";
import type { WorkspaceAgentRpc } from "./types";

export type ComputerLeasePayload = { token: string };
export type ComputerControlPayload = { stop?: boolean; token: string };

export interface ComputerStatus {
  checkpointAt: string | null;
  ownerControl: boolean;
  resources: ComputerResources | null;
  running: boolean;
}

export interface ComputerStorage {
  delete(key: string): Promise<unknown>;
  delete(keys: string[]): Promise<unknown>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface ComputerRuntimeOptions {
  botId: string;
  env: Env;
  storage: ComputerStorage;
  workspaceAgent: WorkspaceAgentRpc;
  cancelSchedule: (id: string) => Promise<boolean>;
  hasManagedProcess?: () => boolean;
  scheduleControl: (when: Date, payload: ComputerControlPayload) => Promise<{ id: string }>;
  scheduleSleep: (when: Date, payload: ComputerLeasePayload) => Promise<{ id: string }>;
}
