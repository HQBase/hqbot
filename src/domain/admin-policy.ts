import { z } from "zod";
export const adminPolicyInput = z.object({
  mode: z.enum(["standard", "connectors-only"]),
  origins: z
    .array(
      z.string().refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && url.origin === value;
        } catch {
          return false;
        }
      }, "Use an exact HTTPS origin")
    )
    .max(100)
});
export type AdminPolicy = z.infer<typeof adminPolicyInput>;
export function assertConnectorPolicy(policy: AdminPolicy, url: string) {
  if (policy.mode === "connectors-only" && !policy.origins.includes(new URL(url).origin))
    throw new Error("Workspace policy does not allow this MCP server");
}
export function assertAgentToolPolicy(policy: AdminPolicy, name: string) {
  const allowed = new Set([
    "manage_task",
    "manage_knowledge",
    "manage_automation",
    "schedule",
    "search_history",
    "search_memories",
    "discover_skills",
    "load_skill",
    "collaborate",
    "codemode",
    "stop_process",
    "list_files",
    "read_file"
  ]);
  if (policy.mode === "connectors-only" && !allowed.has(name))
    throw new Error(
      "Workspace policy restricts agent work to approved connectors and saved files. Computer and local commands are disabled."
    );
}
