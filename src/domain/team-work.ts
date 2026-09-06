import { z } from "zod";
import type { TeamPolicy } from "./team-policy";

const text = z.string().trim().min(1).max(4000);
export const teamWorkInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("team") }),
  z.object({ action: z.literal("settings") }),
  z.object({
    action: z.literal("hire"),
    key: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(80),
    role: z.string().trim().min(1).max(1000),
    modelId: z.string().optional(),
    manager: z.boolean().optional()
  }),
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
    criterion: text,
    modelId: z.string().optional()
  }),
  z.object({
    action: z.literal("report"),
    summary: text,
    nextStep: text,
    blocked: z.boolean().default(false)
  }),
  z.object({
    action: z.enum(["check_in", "redirect"]),
    assignmentId: z.string(),
    key: z.string().trim().min(1).max(80),
    message: text
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
  parentId?: string | null;
  managerBotId?: string;
  depth?: number;
  modelId?: string | null;
  waiting?: boolean;
  progress?: { summary: string; nextStep: string; blocked: boolean; updatedAt: string } | null;
}
export interface TeamUpdate {
  id: string;
  assignmentId: string | null;
  senderBotId: string;
  recipientBotId: string;
  kind: string;
  message: string;
  acknowledged: boolean;
  createdAt: string;
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
  updates?: TeamUpdate[];
}
export interface TeamTurn {
  id: string;
  workId: string;
  botId: string;
  assignmentId: string | null;
  state: string;
  prompt: string;
  modelId?: string | null;
}
export interface TeamWorkRpc {
  getTeamPolicy(botId: string): Promise<TeamPolicy>;
  teamBriefing(
    botId: string,
    workId: string
  ): Promise<{ modelId: string | null; assignmentId: string | null; instructions: string } | null>;
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
  finishTeamOwnerTurn(
    workId: string,
    botId: string,
    failed: boolean,
    token?: string
  ): Promise<void>;
  finishTeamTurn(id: string, botId: string, result: string, failed: boolean): Promise<void>;
}
