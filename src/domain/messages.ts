import { z } from "zod";

export const messageSource = z.object({
  kind: z.enum(["bot", "project"]),
  id: z.string().min(1).max(200),
  messageId: z.string().min(1).max(300)
});
export type MessageSource = z.infer<typeof messageSource>;
export const reactionInput = z.object({
  emoji: z.enum(["👍", "❤️", "✅", "👀", "🎉"]),
  active: z.boolean()
});
export interface DiscussionNote {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
}
export interface Discussion {
  notes: DiscussionNote[];
  reactions: { emoji: string; count: number; mine: boolean }[];
}
export interface SearchHit {
  id: string;
  kind: "message" | "project" | "file" | "skill" | "memory";
  label: string;
  text: string;
  botId?: string;
  projectId?: string;
  createdAt?: string;
}
