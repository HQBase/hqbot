import type { PendingAction } from "@cloudflare/codemode";

export type IntegrationApproval = PendingAction & { inputHash: string };
export interface ActionRecord {
  id: string;
  executionId: string;
  seq: number;
  connector: string;
  method: string;
  args: unknown;
  inputHash: string;
  state: string;
  result: unknown;
  updatedAt: string;
}
