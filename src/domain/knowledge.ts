import { z } from "zod";
import type { BotMemory, BotSkill } from "./types";

export const knowledgeWrite = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("memory"),
    id: z.string().min(1).max(200).optional(),
    revision: z.number().int().positive().optional(),
    content: z.string().trim().min(1).max(1500),
    category: z.enum(["preference", "fact", "method"]).default("preference"),
    source: z.string().trim().min(1).max(300)
  }),
  z.object({
    kind: z.literal("skill"),
    id: z.string().min(1).max(200).optional(),
    revision: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    instructions: z.string().trim().min(1).max(12_000),
    status: z.enum(["draft", "ready"]).default("draft"),
    source: z.string().trim().min(1).max(300)
  })
]);
export type KnowledgeWrite = z.infer<typeof knowledgeWrite>;
export interface KnowledgeMeta {
  revision: number;
  source: string;
  category: string;
  status: "draft" | "ready";
  updatedAt: string;
}
export type KnowledgeItem = KnowledgeMeta &
  ((BotMemory & { kind: "memory" }) | (BotSkill & { kind: "skill" }));
export interface KnowledgeVersion {
  revision: number;
  createdAt: string;
  item: KnowledgeItem;
}
export interface KnowledgeRpc {
  saveKnowledge(botId: string, commandId: string, input: KnowledgeWrite): Promise<KnowledgeItem>;
  forgetKnowledge(botId: string, kind: "memory" | "skill", id: string): Promise<boolean>;
  listKnowledge(botId: string): Promise<KnowledgeItem[]>;
  knowledgeHistory(botId: string, id: string): Promise<KnowledgeVersion[]>;
}
