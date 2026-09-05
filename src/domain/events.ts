import { z } from "zod";

export const eventFilter = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("generic"), eventType: z.string().trim().max(100).default("") }),
  z.object({
    provider: z.literal("github"),
    repository: z
      .string()
      .trim()
      .regex(/^[\w.-]+\/[\w.-]+$/u),
    action: z.string().trim().max(100).default("")
  }),
  z.object({
    provider: z.literal("slack"),
    teamId: z.string().regex(/^T[A-Z0-9]+$/u),
    channelId: z.string().regex(/^[CGD][A-Z0-9]+$/u)
  })
]);
export type EventFilter = z.infer<typeof eventFilter>;
export const eventTriggerInput = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive().optional(),
  botId: z.string().min(1).max(200),
  routineId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  filter: eventFilter,
  secret: z.string().min(16).max(256).optional()
});
export type EventTriggerInput = z.infer<typeof eventTriggerInput>;
export interface EventTrigger {
  id: string;
  revision: number;
  botId: string;
  routineId: string;
  name: string;
  enabled: boolean;
  filter: EventFilter;
  createdAt: string;
  updatedAt: string;
}
export interface EventReceipt {
  id: string;
  state: "accepted" | "ignored";
  runId: string | null;
  createdAt: string;
}
export interface VerifiedEvent {
  id: string;
  digest: string;
  body: Record<string, unknown>;
  challenge?: string;
  ignored: boolean;
}
