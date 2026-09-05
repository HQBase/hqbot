import { z } from "zod";
export const teamRole = z.enum(["admin", "member", "viewer"]);
export interface Principal {
  id: string;
  username: string;
  role: "owner" | z.infer<typeof teamRole>;
}
export interface TeamUser extends Principal {
  disabled: boolean;
  projectIds: string[];
  createdAt: string;
}
export interface TeamInvite {
  id: string;
  role: z.infer<typeof teamRole>;
  projectIds: string[];
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}
export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  targetId: string;
  createdAt: string;
}
export const inviteInput = z.object({
  role: teamRole,
  projectIds: z.array(z.string().min(1).max(200)).max(100)
});
export const teamUpdate = z.object({
  role: teamRole,
  disabled: z.boolean(),
  projectIds: z.array(z.string().min(1).max(200)).max(100)
});
