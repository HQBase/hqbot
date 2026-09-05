import { type Action, action, type PendingApproval } from "@cloudflare/think";
import type { ModelMessage, ToolSet } from "ai";
import type { Sql } from "../workspace/sql";
import { ActionHistory } from "./action-history";
import { canonicalizeJson, sha256Hex, TeammateExternalEffects } from "./external-effects";

export const COMPUTER_ACTIONS = new Set([
  "bash",
  "computer_session",
  "browser_open",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_evaluate",
  "browser_tabs",
  "desktop_mouse",
  "desktop_keyboard",
  "copy_file_to_computer",
  "delete_file"
]);
export type ComputerPolicy = "review" | "allow";
export class ComputerPermissions {
  constructor(
    private readonly sql: Sql,
    private readonly host: {
      pending: () => Promise<PendingApproval[]>;
      approve: (id: string) => Promise<unknown>;
      reject: (id: string) => Promise<unknown>;
      isActive: () => Promise<boolean>;
      uncertain: () => Promise<void>;
    }
  ) {}
  get(): ComputerPolicy {
    return (
      this.sql<{
        mode: ComputerPolicy;
      }>`SELECT mode FROM hqbot_computer_permissions WHERE slot = 1`[0]?.mode ?? "review"
    );
  }
  set(mode: ComputerPolicy): void {
    if (mode !== "review" && mode !== "allow") throw new Error("Invalid computer permission");
    this.sql`UPDATE hqbot_computer_permissions SET mode = ${mode} WHERE slot = 1`;
  }
  async pending() {
    const pending = (await this.host.pending()).filter((item) => item.source === "action");
    return Promise.all(
      pending.map(async (item) => ({
        executionId: item.executionId,
        action: item.descriptor.action,
        input: item.descriptor.input,
        inputHash: await sha256Hex(canonicalizeJson(item.descriptor.input))
      }))
    );
  }
  async decide(id: string, hash: string, approved: boolean) {
    if (!(await this.host.isActive())) throw new Error("Restore this teammate before continuing");
    const pending = (await this.pending()).find((item) => item.executionId === id);
    if (!pending || pending.inputHash !== hash)
      throw new Error("This computer approval is stale. Refresh before deciding.");
    return approved ? this.host.approve(id) : this.host.reject(id);
  }
  actions(tools: ToolSet): Record<string, Action> {
    const history = new ActionHistory(this.sql);
    const effects = new TeammateExternalEffects(this.sql);
    return Object.fromEntries(
      Object.entries(tools)
        .filter(([name]) => COMPUTER_ACTIONS.has(name))
        .map(([name, tool]) => [
          name,
          action({
            description: typeof tool.description === "string" ? tool.description : name,
            inputSchema: tool.inputSchema,
            kind: "durable-pause",
            approval: ({ input }) => {
              const value = input as Record<string, unknown>;
              if (
                name === "computer_session" &&
                (value.action === "start" || value.action === "give_to_owner")
              )
                return false;
              if (name === "browser_tabs" && value.operation === "list") return false;
              return this.get() === "review";
            },
            approvalSummary: `Allow this computer action: ${name}`,
            approvalRisk: "high",
            timeoutMs: 180_000,
            idempotencyKey: ({ ctx }) => `computer:${ctx.toolCallId}`,
            execute: async (input, ctx) => {
              if (!(await this.host.isActive())) throw new Error("The teammate is not active");
              const executionId = `computer:${ctx.toolCallId}`;
              const identity = {
                executionId,
                seq: 0,
                connector: "computer",
                method: name,
                args: input
              };
              const entry = await history.pending(identity);
              history.decide(executionId, 0, entry.inputHash, "approved");
              try {
                const execute = tool.execute as
                  | ((
                      input: unknown,
                      options: {
                        toolCallId: string;
                        messages: ModelMessage[];
                        abortSignal: AbortSignal;
                      }
                    ) => Promise<unknown>)
                  | undefined;
                if (!execute) throw new Error("Computer action is not available");
                const result = await effects.run(identity, async () =>
                  execute(input, {
                    toolCallId: ctx.toolCallId,
                    messages: [...ctx.messages],
                    abortSignal: ctx.signal
                  })
                );
                history.outcome(executionId, 0, "applied", result ?? null);
                return result;
              } catch (cause) {
                history.outcome(executionId, 0, "uncertain", null);
                await this.host.uncertain();
                throw cause;
              }
            }
          })
        ])
    );
  }
}
