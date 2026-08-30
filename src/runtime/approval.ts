export interface ReplyApproval {
  executionId: string;
  taskId: string;
  draft: string;
}

interface ApprovalLookup {
  executionId?: string;
  taskId?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function findReplyApproval(
  pending: readonly unknown[],
  lookup: ApprovalLookup
): ReplyApproval | null {
  for (const candidate of pending) {
    const item = record(candidate);
    const descriptor = record(item?.descriptor);
    const input = record(descriptor?.input);
    const executionId = item?.executionId;
    const taskId = input?.taskId;
    const draft = input?.draft;
    if (
      item?.source !== "action" ||
      descriptor?.action !== "send_hqbase_reply" ||
      typeof executionId !== "string" ||
      typeof taskId !== "string" ||
      typeof draft !== "string" ||
      taskId.length === 0 ||
      taskId.length > 200 ||
      draft.length === 0 ||
      draft.length > 100_000
    ) {
      continue;
    }
    if (lookup.executionId && executionId !== lookup.executionId) continue;
    if (lookup.taskId && taskId !== lookup.taskId) continue;
    return { executionId, taskId, draft };
  }
  return null;
}

export type ReplyApprovalOutcome = "approved" | "rejected" | "failed" | "conflict";

interface ResolveReplyApprovalInput {
  executionId: string;
  approved: boolean;
  pending: Promise<readonly unknown[]>;
  resolve: () => Promise<unknown>;
  recordRejection: (taskId: string) => Promise<void>;
  fail: (taskId: string) => Promise<void>;
}

interface ExecuteApprovedReplyInput<Result> {
  taskId: string;
  recordDecision: (taskId: string) => Promise<void>;
  send: () => Promise<Result>;
}

export function replyApprovalOutcome(output: unknown, approved: boolean): ReplyApprovalOutcome {
  const result = record(output);
  if (!result || typeof result.status !== "string") return approved ? "approved" : "conflict";
  if (result.status === "rejected") return approved ? "conflict" : "rejected";
  if (result.status !== "error") return approved ? "approved" : "conflict";
  const detail = typeof result.error === "string" ? result.error : "";
  return detail.includes("no longer pending") ? "conflict" : "failed";
}

export async function resolveReplyApprovalLifecycle(
  input: ResolveReplyApprovalInput
): Promise<unknown> {
  const approval = findReplyApproval(await input.pending, { executionId: input.executionId });
  const output = await input.resolve();
  if (!approval) return output;
  const outcome = replyApprovalOutcome(output, input.approved);
  if (outcome === "rejected") await input.recordRejection(approval.taskId);
  if (outcome === "failed") await input.fail(approval.taskId);
  return output;
}

export async function executeApprovedReply<Result>(
  input: ExecuteApprovedReplyInput<Result>
): Promise<Result> {
  await input.recordDecision(input.taskId);
  return input.send();
}
