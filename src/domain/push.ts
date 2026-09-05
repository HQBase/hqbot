import { z } from "zod";

export function allowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      (["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(
        url.hostname
      ) ||
        url.hostname.endsWith(".push.services.mozilla.com") ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
export const pushPreferences = z.object({
  replies: z.boolean().default(true),
  failures: z.boolean().default(true),
  input: z.boolean().default(true)
});
export type PushPreferences = z.infer<typeof pushPreferences>;
export const pushDeviceInput = z.object({
  name: z.string().trim().min(1).max(80),
  preferences: pushPreferences,
  subscription: z.object({
    endpoint: z.string().max(3000).refine(allowedPushEndpoint, "Unsupported browser push service"),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/u),
      auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
    })
  })
});
export type PushDeviceInput = z.infer<typeof pushDeviceInput>;
export interface PushDevice {
  id: string;
  name: string;
  preferences: PushPreferences;
  createdAt: string;
  lastStatus: string | null;
}
export function wantsPush(kind: string, prefs: PushPreferences): boolean {
  return ["input", "approval"].includes(kind)
    ? prefs.input
    : kind === "failed"
      ? prefs.failures
      : prefs.replies;
}
