import { buildPushPayload } from "@block65/webcrypto-web-push";
import { allowedPushEndpoint, type PushDeviceInput } from "../domain/push";

export interface VapidConfiguration {
  publicKey: string;
  privateKey: string;
  subject: string;
}
function base64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export async function createPushKeys(origin: string): Promise<VapidConfiguration> {
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify"
  ]);
  const privateKey = await crypto.subtle.exportKey("jwk", key.privateKey);
  if (!privateKey.d) throw new Error("Push keys could not be generated");
  const subject = new URL(origin);
  subject.protocol = "https:";
  return {
    subject: subject.origin,
    publicKey: base64(await crypto.subtle.exportKey("raw", key.publicKey)),
    privateKey: privateKey.d
  };
}
export async function sendDevicePush(
  subscription: PushDeviceInput["subscription"],
  keys: VapidConfiguration,
  message: { id: string; botId: string | null; kind: string },
  send: typeof fetch = fetch
): Promise<"sent" | "expired" | "retry" | "failed"> {
  if (!allowedPushEndpoint(subscription.endpoint)) return "failed";
  if (subscription.expirationTime && subscription.expirationTime <= Date.now()) return "expired";
  let payload: Awaited<ReturnType<typeof buildPushPayload>>;
  try {
    payload = await buildPushPayload(
      { data: JSON.stringify(message), options: { ttl: 86400 } },
      { ...subscription, expirationTime: subscription.expirationTime ?? null },
      keys
    );
  } catch {
    return "failed";
  }
  try {
    const response = await send(subscription.endpoint, {
      ...payload,
      redirect: "error",
      signal: AbortSignal.timeout(10000)
    });
    await response.body?.cancel();
    if (response.status >= 200 && response.status < 300) return "sent";
    if ([404, 410].includes(response.status)) return "expired";
    return response.status === 429 || response.status >= 500 ? "retry" : "failed";
  } catch {
    return "retry";
  }
}
