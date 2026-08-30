import { api } from "./api";

export class InitialMessageAdmissionUnknownError extends Error {
  constructor(cause: TypeError) {
    super("The connection was interrupted. Waiting to confirm your message…", { cause });
    this.name = "InitialMessageAdmissionUnknownError";
  }
}

export async function submitInitialMessage(botId: string, message: string): Promise<void> {
  const submit = () =>
    api(`/api/bots/${botId}/messages/initial`, {
      method: "POST",
      body: JSON.stringify({ prompt: message })
    });
  try {
    await submit();
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    try {
      await submit();
    } catch (retryCause) {
      if (retryCause instanceof TypeError)
        throw new InitialMessageAdmissionUnknownError(retryCause);
      throw retryCause;
    }
  }
}
