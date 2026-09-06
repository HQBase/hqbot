import type { UIMessage } from "ai";

// Recover only an answer inside the exact durable submission's message boundary.
export function savedTeamResult(messages: UIMessage[], submissionId: string): string | null {
  const start = messages.findIndex(
    (message) => message.id === submissionId && message.role === "user"
  );
  if (start < 0) return null;
  const remaining = messages.slice(start + 1);
  if (remaining.some((message) => message.role === "user")) return null;
  const last = remaining.findLast((message) => message.role === "assistant");
  const text = last?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text ? text.slice(0, 12000) : null;
}
