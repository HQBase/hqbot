import type { UIMessage } from "ai";

export function isInternalContinuation(message: UIMessage): boolean {
  if (message.role !== "user") return false;
  const metadata = message.metadata as { turnMetadata?: { source?: unknown } } | null | undefined;
  return ["active-task", "computer-decision", "integration-result"].includes(
    String(metadata?.turnMetadata?.source)
  );
}
