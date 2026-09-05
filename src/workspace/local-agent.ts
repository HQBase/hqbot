import { getAgentByName } from "agents";
import type { HQBotTeammate } from "../teammate";
import { digest, randomToken } from "./auth";
import { WorkspaceLocalDevices } from "./local-devices";
import { WorkspaceTeamAgent } from "./team-agent";

export class WorkspaceLocalAgent extends WorkspaceTeamAgent {
  private deliveringLocal = false;
  private get local() {
    return new WorkspaceLocalDevices(this.db);
  }
  override async onStart() {
    await super.onStart();
    if (this.local.list().length) await this.scheduleEvery(60, "deliverLocalResults", {});
  }
  listLocalDevices(botId?: string) {
    return this.local.list(botId);
  }
  async createLocalPairing(ids: string[]) {
    const code = randomToken(32);
    const hash = await digest(code);
    return { code, ...this.local.createPairing(hash, ids) };
  }
  async pairLocalDevice(code: string, name: string) {
    const token = randomToken(32);
    const [codeHash, tokenHash] = await Promise.all([digest(code), digest(token)]);
    await this.scheduleEvery(60, "deliverLocalResults", {});
    const id = this.ctx.storage.transactionSync(() => this.local.pair(codeHash, tokenHash, name));
    return { id, token };
  }
  async identifyLocalDevice(token: string) {
    if (token.length < 32 || token.length > 100) return null;
    return this.local.identify(await digest(token));
  }
  localJobs() {
    return this.local.history();
  }
  async queueLocalCommand(botId: string, taskId: string | null, id: string, input: unknown) {
    if (this.getAdminPolicy().mode === "connectors-only")
      throw new Error("Workspace network policy blocks local commands");
    await this.scheduleEvery(60, "deliverLocalResults", {});
    return this.ctx.storage.transactionSync(() => this.local.queue(botId, taskId, id, input));
  }
  readLocalJob(botId: string, id: string) {
    const job = this.local.read(id);
    return job?.botId === botId ? job : null;
  }
  localResultAllowed(botId: string, id: string) {
    return this.local.resultAllowed(botId, id);
  }
  deviceLocalJob(deviceId: string, id: string) {
    const job = this.local.read(id);
    return job?.deviceId === deviceId ? job : null;
  }
  pollLocalDevice(id: string) {
    return this.getAdminPolicy().mode === "connectors-only" ? [] : this.local.poll(id);
  }
  claimLocalJob(deviceId: string, id: string, claimId: string) {
    if (this.getAdminPolicy().mode === "connectors-only")
      throw new Error("Workspace policy blocks local commands");
    return this.ctx.storage.transactionSync(() => this.local.claim(deviceId, id, claimId));
  }
  startLocalJob(deviceId: string, id: string, claimId: string) {
    if (this.getAdminPolicy().mode === "connectors-only")
      throw new Error("Workspace policy blocks local commands");
    return this.ctx.storage.transactionSync(() => this.local.start(deviceId, id, claimId));
  }
  async finishLocalJob(deviceId: string, input: unknown) {
    await this.schedule(1, "deliverLocalResults", {}, { idempotent: true });
    return this.ctx.storage.transactionSync(() => this.local.finish(deviceId, input));
  }
  revokeLocalDevice(id: string) {
    this.local.revoke(id);
  }
  protected override cancelBotDeliveries(botId: string) {
    super.cancelBotDeliveries(botId);
    this.local.cancelBot(botId);
  }
  async deliverLocalResults() {
    if (this.deliveringLocal) return;
    this.deliveringLocal = true;
    try {
      this.local.recovery();
      for (const job of this.local.pendingResults()) {
        try {
          const bot = this.getBot(job.botId);
          if (!bot || bot.hidden) {
            this.local.delivered(job.id);
            continue;
          }
          await (
            await getAgentByName<Env, HQBotTeammate>(this.env.HQBOT_TEAMMATE, job.botId)
          ).receiveLocalResult(job.id);
          this.local.delivered(job.id);
        } catch {
          /* Keep the durable result for the next delivery attempt. */
        }
      }
    } finally {
      this.deliveringLocal = false;
    }
  }
}
