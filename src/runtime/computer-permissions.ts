import { type Action, action, type PendingApproval } from "@cloudflare/think";
import type { ModelMessage, ToolSet } from "ai";
import type { ComputerPolicy } from "../domain/computer-review";
import type { PermissionDecision } from "../domain/permissions";
import type { Sql } from "../workspace/sql";
import { ActionHistory } from "./action-history";
import type { ComputerSafety } from "./computer-safety";
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
export type { ComputerPolicy } from "../domain/computer-review";
export class ComputerPermissions {
  constructor(
    private readonly sql: Sql,
    private readonly host: {
      safety?: ComputerSafety;
      pending: () => Promise<PendingApproval[]>;
      approve: (id: string) => Promise<unknown>;
      reject: (id: string) => Promise<unknown>;
      isActive: () => Promise<boolean>;
      authorize?: (name: string, input: unknown) => Promise<void>;
      beforeDecision?: (id: string, approved: boolean, automatic?: boolean) => Promise<void>;
      uncertain: () => Promise<void>;
      permission?: (
        action: string,
        input: unknown,
        fallback: PermissionDecision
      ) => PermissionDecision;
    }
  ) {}
  get(): ComputerPolicy {
    return (
      this.sql<{
        mode: ComputerPolicy;
      }>`SELECT mode FROM hqbot_computer_permissions WHERE slot = 1`[0]?.mode ?? "autonomous"
    );
  }
  set(mode: ComputerPolicy): void {
    if (!["autonomous", "review", "allow"].includes(mode))
      throw new Error("Invalid computer permission");
    this.sql`UPDATE hqbot_computer_permissions SET mode = ${mode} WHERE slot = 1`;
  }
  async pending() {
    const pending = (await this.host.pending()).filter((item) => item.source === "action");
    return Promise.all(
      pending.map(async (item) => {
        const input = item.descriptor.input as Record<string, unknown>;
        const id = item.descriptor.toolCallId;
        const safety = this.host.safety;
        const review = safety
          ? await safety.prepare(id, item.descriptor.action, input, this.get())
          : null;
        return {
          executionId: item.executionId,
          action: item.descriptor.action,
          input,
          inputHash:
            review && safety
              ? await safety.hash(input, review)
              : await sha256Hex(canonicalizeJson(input)),
          ...(review ? { review: review.view } : {})
        };
      })
    );
  }
  async reconcile() {
    if (this.get() !== "autonomous" || !this.host.safety) return;
    for (const pending of await this.pending()) {
      if (pending.review?.decision !== "allow") continue;
      if ((this.host.permission?.(pending.action, pending.input, "allow") ?? "allow") !== "allow")
        continue;
      await this.decide(pending.executionId, pending.inputHash, true, true);
    }
  }

  async decide(id: string, hash: string, approved: boolean, automatic = false) {
    if (!(await this.host.isActive())) throw new Error("Restore this teammate before continuing");
    const pending = (await this.pending()).find((item) => item.executionId === id);
    if (!pending || pending.inputHash !== hash)
      throw new Error("This computer approval is stale. Refresh before deciding.");
    if (approved && this.host.safety) {
      const descriptor = (await this.host.pending()).find(
        (item) => item.executionId === id
      )?.descriptor;
      if (!descriptor) throw new Error("This approval is no longer pending");
      const review = await this.host.safety.prepare(
        descriptor.toolCallId,
        descriptor.action,
        descriptor.input as Record<string, unknown>,
        this.get()
      );
      await this.host.safety.validate(
        descriptor.action,
        descriptor.input as Record<string, unknown>,
        review
      );
      this.host.safety.markApproved(descriptor.toolCallId);
    }
    await this.host.beforeDecision?.(id, approved, automatic);
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
            approval: async ({ input, ctx }) => {
              await this.host.authorize?.(name, input);
              const value = input as Record<string, unknown>;
              const safety = this.host.safety;
              const review = safety
                ? await safety.prepare(ctx.toolCallId, name, value, this.get())
                : null;
              const routine =
                (name === "computer_session" &&
                  ["start", "give_to_owner", "take_back"].includes(String(value.action))) ||
                (name === "browser_tabs" && value.operation === "list");
              const fallback: PermissionDecision =
                review?.view.decision ?? (routine || this.get() === "allow" ? "allow" : "review");
              const decision = this.host.permission?.(name, input, fallback) ?? fallback;
              if (decision === "deny")
                throw new Error("An owner permission rule blocks this action");
              if (review?.view.unavailable) throw new Error(review.view.reason);
              return decision === "review";
            },
            approvalSummary: `Allow this computer action: ${name}`,
            approvalRisk: "high",
            timeoutMs: 180_000,
            idempotencyKey: ({ ctx }) => `computer:${ctx.toolCallId}`,
            execute: async (input, ctx) => {
              await this.host.authorize?.(name, input);
              if (!(await this.host.isActive())) throw new Error("The teammate is not active");
              if (this.host.permission?.(name, input, "review") === "deny")
                throw new Error("An owner permission rule blocks this action");
              if (this.host.safety) {
                const review = await this.host.safety.prepare(
                  ctx.toolCallId,
                  name,
                  input as Record<string, unknown>,
                  this.get()
                );
                const decision =
                  this.host.permission?.(name, input, review.view.decision) ?? review.view.decision;
                if (decision === "review" && !this.host.safety.isApproved(ctx.toolCallId))
                  throw new Error(
                    "The current policy requires owner approval. Make a new request."
                  );
                await this.host.safety.validate(name, input as Record<string, unknown>, review);
              }
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
                return result && typeof result === "object" && !Array.isArray(result)
                  ? { ...result, actionId: `${executionId}:0` }
                  : { result, actionId: `${executionId}:0` };
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
