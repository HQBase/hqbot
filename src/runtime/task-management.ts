import { z } from "zod";

const taskUsage =
  'Valid examples: {"action":"needs_user","goal":"Finish setup","checkpoint":"Waiting for the owner"} or {"action":"continue","goal":"Finish report","checkpoint":"Research is complete"}';
const taskText = z.string({ error: taskUsage }).trim().min(1).max(20_000);

const criterion = z.object({
  id: z.string().min(1).max(80),
  description: z.string().min(1).max(1000),
  artifactName: z.string().max(200).optional(),
  actionRequired: z.boolean().optional()
});
const evidence = z.object({
  criterionId: z.string().min(1).max(80),
  check: z.string().trim().min(1).max(4000),
  artifactId: z.string().max(200).optional(),
  actionId: z.string().max(300).optional()
});
export type TaskCriterion = z.infer<typeof criterion>;
export type TaskEvidence = z.infer<typeof evidence>;

export const taskManagementInput = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("continue"),
      criteria: z.array(criterion).min(1).max(12).optional(),
      checkpoint: taskText,
      goal: z.string().trim().min(1).max(2_000).optional()
    }),
    z.strictObject({
      action: z.literal("needs_user"),
      criteria: z.array(criterion).min(1).max(12).optional(),
      checkpoint: taskText,
      goal: z.string().trim().min(1).max(2_000).optional()
    }),
    z.strictObject({
      action: z.literal("done"),
      evidence: z.array(evidence).max(12).optional(),
      result: z.string({ error: taskUsage }).trim().min(1).max(50_000)
    })
  ],
  taskUsage
);

export type TaskManagementInput = z.infer<typeof taskManagementInput>;
