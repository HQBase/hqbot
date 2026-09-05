import { z } from "zod";
import { routineSchedule } from "./automations";

export const teammateTemplate = z.object({
  format: z.literal("hqbot-teammate"),
  version: z.literal(1),
  profile: z.object({
    name: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000),
    brief: z.string().trim().min(1).max(2000),
    modelId: z.string().min(1).max(200),
    dailyBudgetUsd: z.number().min(0.1).max(50),
    maxSteps: z.number().int().min(1).max(64).nullable()
  }),
  skills: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().min(1).max(300),
        instructions: z.string().trim().min(1).max(12000)
      })
    )
    .max(30),
  routines: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        prompt: z.string().trim().min(1).max(4000),
        schedule: routineSchedule
      })
    )
    .max(20)
});
export type TeammateTemplate = z.infer<typeof teammateTemplate>;
export interface TemplateShare {
  id: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
}
export function parseTemplate(value: unknown): TeammateTemplate {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 80000)
    throw new Error("Templates must be smaller than 80 KB");
  const parsed = teammateTemplate.parse(value);
  if (
    new Set(parsed.skills.map((item) => item.name.toLocaleLowerCase())).size !==
    parsed.skills.length
  )
    throw new Error("Each skill needs a different name");
  if (
    new Set(parsed.routines.map((item) => item.name.toLocaleLowerCase())).size !==
    parsed.routines.length
  )
    throw new Error("Each routine needs a different name");
  return parsed;
}
