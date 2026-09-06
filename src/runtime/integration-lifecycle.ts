import type { PendingAction } from "@cloudflare/codemode";
import type { ActionHistory } from "./action-history";

interface IntegrationLifecycleRuntime {
  pending(): Promise<PendingAction[]>;
  reject(input: { executionId: string; seq: number }): Promise<boolean>;
}

export async function rejectPendingIntegrationActions(
  runtime: IntegrationLifecycleRuntime,
  connector?: string,
  history?: ActionHistory
): Promise<number> {
  const pending = await runtime.pending();
  let rejected = 0;
  for (const action of pending.filter((item) => !connector || item.connector === connector)) {
    const saved = await history?.pending(action);
    if (await runtime.reject({ executionId: action.executionId, seq: action.seq })) {
      if (saved) history?.decide(action.executionId, action.seq, saved.inputHash, "denied");
      rejected += 1;
    }
  }
  return rejected;
}

export async function integrationApprovalStatus(
  runtime: Pick<IntegrationLifecycleRuntime, "pending">
): Promise<"idle" | "needs_approval"> {
  return (await runtime.pending()).length > 0 ? "needs_approval" : "idle";
}
