import {
  type PushDevice,
  type PushDeviceInput,
  type PushPreferences,
  pushDeviceInput,
  wantsPush
} from "../domain/push";
import { now, type Row, type Sql, text } from "./sql";

export interface PushKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}
export interface PushDelivery {
  id: string;
  deviceId: string;
  userId: string;
  subscription: PushDeviceInput["subscription"];
  notificationId: string | null;
  botId: string | null;
  kind: string;
  attempts: number;
  createdAt: string;
  wanted: boolean;
}
export class WorkspacePush {
  constructor(private readonly sql: Sql) {}
  keys(): PushKeys | null {
    const row = this.sql<Row>`SELECT * FROM push_settings WHERE id = 1`[0];
    return row
      ? {
          publicKey: text(row, "public_key"),
          privateKey: text(row, "private_key"),
          subject: text(row, "subject")
        }
      : null;
  }
  saveKeys(keys: PushKeys) {
    this
      .sql`INSERT OR IGNORE INTO push_settings (id, public_key, private_key, subject) VALUES (1, ${keys.publicKey}, ${keys.privateKey}, ${keys.subject})`;
  }
  list(userId: string): PushDevice[] {
    return this
      .sql<Row>`SELECT * FROM push_devices WHERE user_id = ${userId} ORDER BY created_at`.map(
      (row) => ({
        id: text(row, "id"),
        name: text(row, "name"),
        preferences: JSON.parse(text(row, "preferences_json")) as PushPreferences,
        createdAt: text(row, "created_at"),
        lastStatus: row.last_status === null ? null : text(row, "last_status")
      })
    );
  }
  count() {
    return this.sql<{ count: number }>`SELECT COUNT(*) AS count FROM push_devices`[0]?.count ?? 0;
  }
  save(userId: string, value: unknown): PushDevice {
    const input = pushDeviceInput.parse(value);
    if (input.subscription.expirationTime && input.subscription.expirationTime <= Date.now())
      throw new Error("This browser subscription expired. Enable notifications again.");
    const old = this
      .sql<Row>`SELECT * FROM push_devices WHERE endpoint = ${input.subscription.endpoint}`[0];
    if (old && old.user_id !== userId)
      throw new Error("Remove the previous account's subscription before enabling this device");
    if (!old && this.list(userId).length >= 20)
      throw new Error("Remove a device before adding another");
    const id = old ? text(old, "id") : crypto.randomUUID();
    const stamp = now();
    this
      .sql`INSERT INTO push_devices (id, user_id, endpoint, subscription_json, name, preferences_json, created_at) VALUES (${id}, ${userId}, ${input.subscription.endpoint}, ${JSON.stringify(input.subscription)}, ${input.name}, ${JSON.stringify(input.preferences)}, ${stamp}) ON CONFLICT(id) DO UPDATE SET subscription_json = excluded.subscription_json, name = excluded.name, preferences_json = excluded.preferences_json`;
    const device = this.list(userId).find((item) => item.id === id);
    if (!device) throw new Error("Device could not be saved");
    return device;
  }
  remove(userId: string, id: string) {
    return (
      this.sql`DELETE FROM push_devices WHERE id = ${id} AND user_id = ${userId} RETURNING id`
        .length > 0
    );
  }
  test(userId: string, deviceId: string, id: string) {
    if (!this.list(userId).some((device) => device.id === deviceId))
      throw new Error("Device not found");
    if (!/^[A-Za-z0-9_-]{1,160}$/u.test(id)) throw new Error("Invalid test ID");
    if (
      (this.sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM push_deliveries WHERE device_id = ${deviceId} AND notification_id IS NULL AND created_at > ${new Date(Date.now() - 3600000).toISOString()}`[0]
        ?.count ?? 0) >= 10
    )
      throw new Error("Wait before sending another test alert");
    this
      .sql`INSERT OR IGNORE INTO push_deliveries (id, notification_id, device_id, state, next_at, created_at, updated_at) VALUES (${`test:${deviceId}:${id}`}, NULL, ${deviceId}, 'queued', ${now()}, ${now()}, ${now()})`;
  }
  due(): PushDelivery[] {
    return this
      .sql<Row>`SELECT p.*, d.user_id, d.subscription_json, d.preferences_json, n.kind, n.bot_id FROM push_deliveries p JOIN push_devices d ON d.id = p.device_id LEFT JOIN notifications n ON n.id = p.notification_id WHERE p.state = 'queued' AND p.next_at <= ${now()} ORDER BY p.next_at LIMIT 10`.map(
      (row) => ({
        id: text(row, "id"),
        deviceId: text(row, "device_id"),
        userId: text(row, "user_id"),
        subscription: JSON.parse(text(row, "subscription_json")) as PushDeviceInput["subscription"],
        notificationId: row.notification_id === null ? null : text(row, "notification_id"),
        botId: row.bot_id === null ? null : text(row, "bot_id"),
        kind: row.kind === null ? "test" : text(row, "kind"),
        attempts: Number(row.attempts),
        createdAt: text(row, "created_at"),
        wanted:
          row.notification_id === null ||
          wantsPush(text(row, "kind"), JSON.parse(text(row, "preferences_json")) as PushPreferences)
      })
    );
  }
  claim(delivery: PushDelivery): PushDelivery {
    this
      .sql`UPDATE push_deliveries SET attempts = attempts + 1, next_at = ${new Date(Date.now() + 120000).toISOString()} WHERE id = ${delivery.id} AND state = 'queued'`;
    return { ...delivery, attempts: delivery.attempts + 1 };
  }
  settle(delivery: PushDelivery, result: "sent" | "expired" | "failed" | "retry" | "cancelled") {
    if (result === "expired") {
      this.remove(delivery.userId, delivery.deviceId);
      return;
    }
    const attempts = delivery.attempts;
    const state =
      result === "retry" && attempts < 6 && Date.now() - Date.parse(delivery.createdAt) < 86400000
        ? "queued"
        : result === "retry"
          ? "failed"
          : result;
    const next = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** attempts)).toISOString();
    this
      .sql`UPDATE push_deliveries SET state = ${state}, attempts = ${attempts}, next_at = ${next}, updated_at = ${now()} WHERE id = ${delivery.id} AND state = 'queued'`;
    this
      .sql`UPDATE push_devices SET last_status = ${state === "sent" ? "Push service accepted the alert" : state === "queued" ? "Delivery will retry" : state === "cancelled" ? "Alert disabled by preference" : "Delivery failed. Enable this device again."} WHERE id = ${delivery.deviceId}`;
  }
  clean() {
    this
      .sql`DELETE FROM push_deliveries WHERE state != 'queued' AND updated_at < ${new Date(Date.now() - 30 * 86400000).toISOString()}`;
  }
}
