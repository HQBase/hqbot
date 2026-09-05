import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { allowedPushEndpoint } from "../../src/domain/push";
import { createPushKeys, sendDevicePush } from "../../src/services/push-delivery";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { migrateWorkspace } from "../../src/workspace/migrations";
import { WorkspaceNotifications } from "../../src/workspace/notifications";
import { WorkspacePush } from "../../src/workspace/push";
import type { Sql, SqlValue } from "../../src/workspace/sql";

let db: DatabaseSync;
let sql: Sql;
let store: WorkspacePush;
let notifications: WorkspaceNotifications;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateWorkspace(sql);
  store = new WorkspacePush(sql);
  notifications = new WorkspaceNotifications(sql);
  new WorkspaceCatalog(sql).createBot(
    "bot",
    { name: "Bot", title: "Test", description: "Test" },
    "Test",
    "test",
    2
  );
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});
const base64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url");
async function device() {
  const key = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits"
  ]);
  return {
    name: "Browser",
    preferences: { replies: true, failures: true, input: true },
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      expirationTime: null,
      keys: {
        auth: base64(crypto.getRandomValues(new Uint8Array(16)).buffer),
        p256dh: base64(await crypto.subtle.exportKey("raw", key.publicKey))
      }
    }
  };
}
it("keeps old notifications through upgrade and queues only new notifications once per device", async () => {
  notifications.add("before", "bot", null, "reply", "Reply ready");
  db.exec(
    "DROP TRIGGER queue_notification_push; DROP TABLE push_deliveries; DROP TABLE push_devices; DROP TABLE push_settings; DELETE FROM schema_migrations WHERE version = 17"
  );
  migrateWorkspace(sql);
  migrateWorkspace(sql);
  const input = await device();
  store.save("owner", input);
  store.save("owner", input);
  expect(store.count()).toBe(1);
  expect(store.due()).toEqual([]);
  notifications.add("after", "bot", null, "reply", "Reply ready");
  notifications.add("after", "bot", null, "reply", "Duplicate");
  expect(store.due()).toHaveLength(1);
  expect(notifications.list()).toHaveLength(2);
  expect(JSON.stringify(store.list("owner"))).not.toContain(input.subscription.endpoint);
  expect(JSON.stringify(store.list("owner"))).not.toContain(input.subscription.keys.auth);
});
it("applies device preferences, enforces ownership, and clears pending work on removal", async () => {
  const input = await device();
  input.preferences.input = false;
  const saved = store.save("owner", input);
  expect(() => store.save("another", input)).toThrow("previous account");
  notifications.add("approval", "bot", null, "approval", "Review action");
  expect(store.due()[0]?.wanted).toBe(false);
  expect(store.remove("another", saved.id)).toBe(false);
  expect(store.remove("owner", saved.id)).toBe(true);
  expect(store.due()).toEqual([]);
});
it("persists attempts before send, retries temporary failures, and stops at six attempts", async () => {
  vi.useFakeTimers();
  store.save("owner", await device());
  notifications.add("reply", "bot", null, "reply", "Reply ready");
  for (let attempt = 1; attempt <= 6; attempt++) {
    const pending = store.due()[0];
    expect(pending).toBeDefined();
    if (!pending) throw new Error("Missing delivery");
    const claimed = store.claim(pending);
    expect(claimed.attempts).toBe(attempt);
    expect(store.due()).toEqual([]);
    store.settle(claimed, "retry");
    vi.advanceTimersByTime(3600001);
  }
  expect(store.due()).toEqual([]);
  expect(db.prepare("SELECT state, attempts FROM push_deliveries").get()).toMatchObject({
    state: "failed",
    attempts: 6
  });
});
it("removes expired device subscriptions and preserves inbox notifications", async () => {
  store.save("owner", await device());
  notifications.add("reply", "bot", null, "reply", "Reply ready");
  const pending = store.due()[0];
  if (!pending) throw new Error("Missing delivery");
  store.settle(store.claim(pending), "expired");
  expect(store.count()).toBe(0);
  expect(notifications.list()).toHaveLength(1);
});
it("encrypts payloads with current Web Push encoding and handles provider results without redirects", async () => {
  const keys = await createPushKeys("https://hqbot.test");
  const input = await device();
  let status = 201;
  const send = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    const headers = new Headers(init?.headers);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(headers.get("authorization")).toMatch(/^vapid t=/u);
    const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
    expect(bytes.byteLength).toBe(4096);
    expect(new TextDecoder().decode(bytes)).not.toContain("notification-one");
    return new Response(null, { status });
  });
  const message = { id: "notification-one", botId: "bot", kind: "reply" };
  expect(await sendDevicePush(input.subscription, keys, message, send)).toBe("sent");
  status = 410;
  expect(await sendDevicePush(input.subscription, keys, message, send)).toBe("expired");
  status = 503;
  expect(await sendDevicePush(input.subscription, keys, message, send)).toBe("retry");
  status = 400;
  expect(await sendDevicePush(input.subscription, keys, message, send)).toBe("failed");
});
it("restricts endpoints to browser push services", () => {
  for (const url of [
    "http://fcm.googleapis.com/send",
    "https://localhost/send",
    "https://fcm.googleapis.com.attacker.test/send",
    "https://fcm.googleapis.com:8443/send",
    "https://user:password@web.push.apple.com/send"
  ])
    expect(allowedPushEndpoint(url)).toBe(false);
  for (const url of [
    "https://fcm.googleapis.com/send",
    "https://updates.push.services.mozilla.com/send",
    "https://web.push.apple.com/send",
    "https://wns.notify.windows.com/send"
  ])
    expect(allowedPushEndpoint(url)).toBe(true);
});
