import type { TeamUpdate } from "./team-work";

export const QUESTION_TIMEOUT_MS = 10 * 60_000;
export const MAX_ASSIGNMENT_QUESTIONS = 3;
export const MAX_TASK_QUESTIONS = 20;

export interface TeamQuestion {
  id: string;
  senderBotId: string;
  recipientBotId: string;
  sourceAssignmentId: string;
  targetAssignmentId: string;
  question: string;
  createdAt: string;
  response?: TeamUpdate;
}

export function teamQuestions(updates: TeamUpdate[] = []): TeamQuestion[] {
  return updates
    .filter((item) => item.kind === "question")
    .flatMap((item) => {
      try {
        const value = JSON.parse(item.message);
        if (typeof value.text !== "string" || typeof value.sourceAssignmentId !== "string")
          return [];
        return [
          {
            id: item.id,
            senderBotId: item.senderBotId,
            recipientBotId: item.recipientBotId,
            sourceAssignmentId: value.sourceAssignmentId,
            targetAssignmentId: item.assignmentId ?? "",
            question: value.text,
            createdAt: item.createdAt,
            response: updates.find((answer) => answer.id === `answer:${item.id}`)
          }
        ];
      } catch {
        return [];
      }
    });
}
