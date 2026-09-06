import type { OwnerAttention } from "./domain/attention";
import { ActionHistory } from "./runtime/action-history";
import type { ComputerPolicy } from "./runtime/computer-permissions";
import { OwnerHandoffs } from "./runtime/owner-handoff";
import { TeammateRuntime } from "./teammate-runtime";
import type { Sql } from "./workspace/sql";

const scheduleRetry = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 10000 };
export abstract class TeammateOwnerRuntime extends TeammateRuntime {
  private handoffs: OwnerHandoffs | null = null;
  protected get ownerHandoffs(): OwnerHandoffs {
    this.handoffs ??= new OwnerHandoffs(this.sql.bind(this) as Sql, {
      allowed: () => this.canAct(),
      teamWorkId: () => this.currentTeamWorkId(),
      release: () => this.computerRuntime.setOwnerControl(false),
      reconnect: async () => {
        const policy = await this.workspaceAgent.checkSpendPolicy(this.name, null);
        if (!policy.allowed) throw new Error(policy.reason ?? "The computer reached its limit");
        await this.computerRuntime.open({
          eventId: `handoff-reconnect:${crypto.randomUUID()}`,
          taskId: this.currentTaskId()
        });
        return this.computerRuntime.setOwnerControl(true);
      },
      scheduleRecovery: async () => {
        await this.schedule(5, "recoverRuntime", {}, { idempotent: true, retry: scheduleRetry });
      },
      flush: () =>
        new ActionHistory(this.sql.bind(this) as Sql).flush((id, text) =>
          this.continueSavedAction(id, text)
        ),
      transaction: (fn) => this.ctx.storage.transactionSync(fn)
    });
    return this.handoffs;
  }
  getComputerPolicy() {
    return this.computerPermissions.get();
  }
  setComputerPolicy(mode: ComputerPolicy) {
    this.computerPermissions.set(mode);
  }
  listComputerApprovals() {
    return this.computerPermissions.pending();
  }
  resolveComputerApproval(id: string, hash: string, approved: boolean) {
    return this.computerPermissions.decide(id, hash, approved);
  }

  async getOwnerAttention(): Promise<OwnerAttention> {
    const [computerApprovals, integrationApprovals, computer] = await Promise.all([
      this.listComputerApprovals(),
      this.integrationRuntime.pending(),
      this.getComputerStatus()
    ]);
    if (computer.ownerControl && !this.ownerHandoffs.pending())
      await this.ownerHandoffs.record("legacy-owner-control");
    const handoff = this.ownerHandoffs.pending();
    return {
      computerApprovals,
      integrationApprovals,
      handoff: handoff ? { id: handoff.id, state: handoff.state, ...computer } : null
    };
  }
  completeOwnerHandoff(id: string) {
    return this.ownerHandoffs.finish(id);
  }
  reconnectOwnerHandoff(id: string) {
    return this.ownerHandoffs.reconnect(id);
  }

  getComputerStatus() {
    return this.computerRuntime.status();
  }

  setComputerControl(ownerControl: boolean) {
    return this.computerRuntime.setOwnerControl(ownerControl);
  }

  renewComputerControl() {
    return this.computerRuntime.setOwnerControl(true, true);
  }
}
