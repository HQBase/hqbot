import { createPushKeys, sendDevicePush } from "../services/push-delivery";
import { WorkspaceEventsAgent } from "./events-agent";
import { WorkspacePush } from "./push";

export class WorkspacePushAgent extends WorkspaceEventsAgent {
  private pushing = false;
  private pushEnabled = false;
  private get push() {
    return new WorkspacePush(this.db);
  }
  override async onStart() {
    await super.onStart();
    this.pushEnabled = this.push.count() > 0;
    if (this.pushEnabled) await this.scheduleEvery(60, "deliverDevicePush", {});
  }
  protected override changed() {
    super.changed();
    if (this.pushEnabled)
      this.ctx.waitUntil(
        this.schedule(1, "deliverDevicePush", {}, { idempotent: true }).catch(() => undefined)
      );
  }
  async configureDevicePush(origin: string) {
    if (!this.push.keys()) this.push.saveKeys(await createPushKeys(origin));
    return { publicKey: this.push.keys()?.publicKey ?? "" };
  }
  listPushDevices(userId: string) {
    return this.push.list(userId);
  }
  async savePushDevice(userId: string, input: unknown) {
    if (!this.push.keys()) throw new Error("Configure device notifications before subscribing");
    await this.scheduleEvery(60, "deliverDevicePush", {});
    const device = this.push.save(userId, input);
    this.pushEnabled = true;
    this.changed();
    return device;
  }
  async removePushDevice(userId: string, id: string) {
    const deleted = this.push.remove(userId, id);
    this.pushEnabled = this.push.count() > 0;
    if (!this.pushEnabled)
      for (const schedule of await this.listSchedules())
        if (schedule.callback === "deliverDevicePush") await this.cancelSchedule(schedule.id);
    this.changed();
    return deleted;
  }
  async testPushDevice(userId: string, id: string, commandId: string) {
    await this.schedule(1, "deliverDevicePush", {}, { idempotent: true });
    this.push.test(userId, id, commandId);
    this.changed();
  }
  protected canNotify(userId: string, _botId: string | null): boolean {
    return userId === "owner";
  }
  async deliverDevicePush() {
    if (this.pushing) return;
    this.pushing = true;
    try {
      const keys = this.push.keys();
      if (!keys || !this.push.count()) {
        this.pushEnabled = false;
        for (const schedule of await this.listSchedules())
          if (schedule.callback === "deliverDevicePush") await this.cancelSchedule(schedule.id);
        return;
      }
      await Promise.all(
        this.push.due().map(async (delivery) => {
          if (!delivery.wanted || !this.canNotify(delivery.userId, delivery.botId)) {
            this.push.settle(delivery, "cancelled");
            return;
          }
          if (delivery.attempts >= 6 || Date.now() - Date.parse(delivery.createdAt) > 86400000) {
            this.push.settle(delivery, "failed");
            return;
          }
          const claimed = this.push.claim(delivery);
          const status = await sendDevicePush(claimed.subscription, keys, {
            id: claimed.notificationId ?? claimed.id,
            botId: claimed.botId,
            kind: claimed.kind
          });
          this.push.settle(claimed, status);
        })
      );
      this.push.clean();
      this.pushEnabled = this.push.count() > 0;
      if (!this.pushEnabled)
        for (const schedule of await this.listSchedules())
          if (schedule.callback === "deliverDevicePush") await this.cancelSchedule(schedule.id);
      super.changed();
    } finally {
      this.pushing = false;
    }
  }
}
