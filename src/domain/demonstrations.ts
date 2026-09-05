import { z } from "zod";
export const demonstrationInput = z.object({
  id: z.string().uuid(),
  botId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(80),
  notes: z.string().trim().min(1).max(4000),
  videoId: z.string().min(1).max(200),
  frames: z
    .array(z.object({ fileId: z.string().min(1).max(200), seconds: z.number().min(0).max(600) }))
    .min(1)
    .max(12)
});
export type DemonstrationInput = z.infer<typeof demonstrationInput>;
export interface Demonstration extends DemonstrationInput {
  state: string;
  attempts: number;
  skillId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export const demonstrationDraft = z.object({
  description: z.string().min(1).max(300),
  instructions: z.string().min(1).max(11000)
});
export type DemonstrationDraft = z.infer<typeof demonstrationDraft>;
