import { z } from "zod";

const taskUsage =
  'Valid examples: {"action":"needs_user","goal":"Finish setup","checkpoint":"Waiting for the owner"} or {"action":"continue","goal":"Finish report","checkpoint":"Research is complete"}';
const taskText = z.string({ error: taskUsage }).trim().min(1).max(20_000);

export const taskManagementInput = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("continue"),
      checkpoint: taskText,
      goal: z.string().trim().min(1).max(2_000).optional()
    }),
    z.strictObject({
      action: z.literal("needs_user"),
      checkpoint: taskText,
      goal: z.string().trim().min(1).max(2_000).optional()
    }),
    z.strictObject({
      action: z.literal("done"),
      result: z.string({ error: taskUsage }).trim().min(1).max(50_000)
    })
  ],
  taskUsage
);

export type TaskManagementInput = z.infer<typeof taskManagementInput>;
