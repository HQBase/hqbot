import { z } from "zod";

export const teamPolicyInput = z
  .object({
    canManage: z.boolean(),
    canCreate: z.boolean(),
    canCreateManagers: z.boolean(),
    allowedModelIds: z.array(z.string().min(1).max(200)).min(1).max(30),
    defaultModelId: z.string().min(1).max(200),
    maxEmployees: z.number().int().min(1).max(30),
    maxConcurrent: z.number().int().min(1).max(12),
    dailyBudgetUsd: z.number().min(0.1).max(50)
  })
  .refine((value) => value.allowedModelIds.includes(value.defaultModelId), {
    message: "The default model must be in the allowed models"
  });
export type TeamPolicy = z.infer<typeof teamPolicyInput>;
