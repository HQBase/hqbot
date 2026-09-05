import { z } from "zod";
export const localCommandInput = z.object({
  deviceId: z.uuid(),
  command: z.string().trim().min(1).max(8000),
  directory: z
    .string()
    .max(500)
    .default("")
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.includes("\\") &&
        !value.split("/").includes("..") &&
        !value.includes("\0"),
      "Use a relative folder within the device workspace"
    )
});
export type LocalCommandInput = z.infer<typeof localCommandInput>;
export interface LocalDevice {
  id: string;
  name: string;
  botIds: string[];
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}
export interface LocalJob {
  id: string;
  deviceId: string;
  botId: string;
  taskId: string | null;
  command: string;
  directory: string;
  state: string;
  claimId: string | null;
  result: string | null;
  createdAt: string;
  updatedAt: string;
}
export const localResultInput = z.object({
  id: z.string().min(1).max(300),
  claimId: z.uuid(),
  state: z.enum(["completed", "denied", "failed", "uncertain"]),
  result: z.string().max(32000)
});
