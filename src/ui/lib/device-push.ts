import type { PushDevice, PushPreferences } from "../../domain/push";
import { api } from "./api";

export const pushDeviceKey = "hqbot:push-device";
export function supportsPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
export async function registerAppWorker() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}
export async function enableDevicePush(
  name: string,
  preferences: PushPreferences
): Promise<PushDevice> {
  if (!supportsPush())
    throw new Error(
      "This browser does not support push here. On iPhone or iPad, add HQBot to your Home Screen and open it there."
    );
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error("Notifications are blocked. Allow them in your browser or device settings.");
  const { publicKey } = await api<{ publicKey: string }>("/api/push/configure", { method: "POST" });
  const registration = await registerAppWorker();
  const binary = atob(publicKey.replaceAll("-", "+").replaceAll("_", "/"));
  const key = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key
    }));
  try {
    const { device } = await api<{ device: PushDevice }>("/api/push/devices", {
      method: "POST",
      body: JSON.stringify({ name, preferences, subscription: subscription.toJSON() })
    });
    localStorage.setItem(pushDeviceKey, device.id);
    return device;
  } catch (cause) {
    await subscription.unsubscribe();
    throw cause;
  }
}
export async function disableDevicePush(id: string) {
  await api(`/api/push/devices/${id}`, { method: "DELETE" });
  if (localStorage.getItem(pushDeviceKey) === id) {
    const registration = await navigator.serviceWorker?.getRegistration();
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
    localStorage.removeItem(pushDeviceKey);
  }
}
