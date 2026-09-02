import { api } from "./api";

interface InitialMessageResponse {
  accepted: boolean;
  error?: string;
  messageApplied?: boolean;
  status?: "pending" | "running" | "completed" | "aborted" | "skipped" | "error";
}

export type InitialMessageDelivery = "pending" | "delivered";

export class InitialMessageAdmissionUnknownError extends Error {
  constructor(cause: TypeError) {
    super("The connection was interrupted. Waiting to confirm your message…", { cause });
    this.name = "InitialMessageAdmissionUnknownError";
  }
}

export function scheduleInitialMessageRetry(attempt: number, retry: () => void): number {
  return window.setTimeout(retry, Math.min(1_000 * 2 ** attempt, 15_000));
}

export async function submitInitialMessage(
  botId: string,
  message: string
): Promise<InitialMessageDelivery> {
  const submit = async () => {
    const result = await api<InitialMessageResponse>(`/api/bots/${botId}/messages/initial`, {
      method: "POST",
      body: JSON.stringify({ prompt: message })
    });
    if (
      !result.accepted &&
      result.messageApplied === false &&
      result.status &&
      !["pending", "running"].includes(result.status)
    ) {
      throw new Error(result.error ?? "The message could not be started");
    }
    return result.accepted || !result.status || ["pending", "running"].includes(result.status)
      ? "pending"
      : "delivered";
  };
  try {
    return await submit();
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    try {
      return await submit();
    } catch (retryCause) {
      if (retryCause instanceof TypeError)
        throw new InitialMessageAdmissionUnknownError(retryCause);
      throw retryCause;
    }
  }
}
