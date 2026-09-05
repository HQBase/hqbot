import { z } from "zod";

const text = z.string().trim().min(1).max(4000);
export const teamWorkInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("team") }),
  z.object({ action: z.literal("status"), workId: z.string().optional() }),
  z.object({
    action: z.literal("start"),
    goal: text,
    criteria: z.array(text).min(1).max(12),
    projectId: z.string().optional(),
    deadlineAt: z.iso.datetime().optional(),
    budgetUsd: z.number().positive().max(50).optional()
  }),
  z.object({
    action: z.literal("assign"),
    key: z.string().trim().min(1).max(80),
    botId: z.string(),
    instruction: text,
    criterion: text
  }),
  z.object({
    action: z.literal("review"),
    assignmentId: z.string(),
    check: text,
    accepted: z.boolean()
  }),
  z.object({ action: z.literal("wait") }),
  z.object({
    action: z.literal("finish"),
    result: text,
    checks: z
      .array(z.object({ criterion: z.number().int().min(0), check: text }))
      .min(1)
      .max(12)
  })
]);
export type TeamWorkInput = z.infer<typeof teamWorkInput>;
export interface TeamAssignment {
  id: string;
  workId: string;
  key: string;
  botId: string;
  instruction: string;
  criterion: string;
  state: string;
  result: string | null;
  review: string | null;
  updatedAt: string;
}
export interface TeamWork {
  id: string;
  ownerBotId: string;
  projectId: string | null;
  goal: string;
  criteria: string[];
  deadlineAt: string;
  budgetUsd: number;
  spentUsd: number;
  state: string;
  result: string | null;
  createdAt: string;
  updatedAt: string;
  assignments: TeamAssignment[];
}
export interface TeamTurn {
  id: string;
  workId: string;
  botId: string;
  assignmentId: string | null;
  state: string;
  prompt: string;
}
export interface TeamWorkRpc {
  coordinate(
    botId: string,
    input: TeamWorkInput,
    workId: string | undefined,
    commandId: string,
    requesterId?: string
  ): Promise<unknown>;
  teamWorkForBot(botId: string, workId?: string): Promise<TeamWork | null>;
  teamTurnForBot(id: string, botId: string): Promise<TeamTurn | null>;
  assertTeamWorkAllowed(id: string, botId: string): Promise<void>;
  finishTeamOwnerTurn(workId: string, botId: string, failed: boolean): Promise<void>;
  finishTeamTurn(id: string, botId: string, result: string, failed: boolean): Promise<void>;
}
