import { z } from "zod";
import type { BotFile, BotSkill } from "./types";

export const projectInput = z.object({
  id: z.string().max(200).optional(),
  revision: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).default(""),
  botIds: z.array(z.string().min(1).max(200)).min(1).max(12),
  resources: z
    .array(
      z.object({
        kind: z.enum(["file", "skill"]),
        id: z.string().min(1).max(200),
        botId: z.string().min(1).max(200)
      })
    )
    .max(100)
    .default([])
});
export type ProjectInput = z.infer<typeof projectInput>;
export type Project = ProjectInput & {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export interface ProjectMessage {
  id: string;
  projectId: string;
  senderBotId: string | null;
  content: string;
  parentId: string | null;
  createdAt: string;
}
export interface CollaborationRequest {
  requesterId?: string;
  id: string;
  projectId: string;
  content: string;
  recipientIds: string[];
  parentId?: string;
  parentDeliveryId?: string;
}
export interface CollaborationDelivery {
  requesterId?: string;
  id: string;
  projectId: string;
  messageId: string;
  botId: string;
  senderBotId: string | null;
  rootId: string;
  depth: number;
  response: boolean;
  state: string;
  prompt: string;
  createdAt: string;
}
export interface ProjectsRpc {
  listProjects(botId?: string): Promise<Project[]>;
  projectMessages(projectId: string, botId?: string, before?: string): Promise<ProjectMessage[]>;
  sendCollaboration(
    senderBotId: string | null,
    input: CollaborationRequest
  ): Promise<ProjectMessage>;
  deliveryForBot(id: string, botId: string): Promise<CollaborationDelivery | null>;
  finishDelivery(id: string, botId: string, content: string, failed?: boolean): Promise<void>;
  projectResources(
    projectId: string,
    botId: string
  ): Promise<{ files: BotFile[]; skills: BotSkill[] }>;
}
