import type { TaskSource } from "./types";

export function needsReplyApproval(source: TaskSource, autoReply: boolean): boolean {
  return source === "email" && !autoReply;
}
