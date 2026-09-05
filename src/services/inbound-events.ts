import type { EventFilter, VerifiedEvent } from "../domain/events";

const encoder = new TextEncoder();
export class InboundEventError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}
export async function boundedBody(
  request: Request,
  limit = 65536
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new InboundEventError("Event is too large", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new InboundEventError("Event is too large", 413);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}
export async function verifyInboundEvent(
  filter: EventFilter,
  secret: string,
  raw: Uint8Array<ArrayBuffer>,
  headers: Headers,
  now = Date.now()
): Promise<VerifiedEvent> {
  if (raw.byteLength > 65536) throw new InboundEventError("Event is too large", 413);
  let signature = headers.get("x-hub-signature-256") ?? "";
  let data = raw;
  let delivery = "";
  if (filter.provider !== "github") {
    const slack = filter.provider === "slack";
    const timestamp = headers.get(slack ? "x-slack-request-timestamp" : "x-hqbot-timestamp") ?? "";
    if (!/^\d{10}$/u.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300)
      throw new InboundEventError("Invalid event signature or timestamp", 401);
    delivery = slack ? "" : (headers.get("x-hqbot-delivery") ?? "");
    if (!slack && !/^[A-Za-z0-9._-]{1,160}$/u.test(delivery))
      throw new InboundEventError("Invalid delivery ID");
    const prefix = encoder.encode(slack ? `v0:${timestamp}:` : `v1:${timestamp}:${delivery}:`);
    data = new Uint8Array(prefix.length + raw.length);
    data.set(prefix);
    data.set(raw, prefix.length);
    signature = headers.get(slack ? "x-slack-signature" : "x-hqbot-signature") ?? "";
  }
  const prefix = filter.provider === "slack" ? "v0=" : "sha256=";
  const digest = signature.slice(prefix.length);
  if (!signature.startsWith(prefix) || !/^[0-9a-f]{64}$/u.test(digest))
    throw new InboundEventError("Invalid event signature", 401);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const bytes = Uint8Array.from(digest.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
  if (!(await crypto.subtle.verify("HMAC", key, bytes, data)))
    throw new InboundEventError("Invalid event signature", 401);
  let body: Record<string, unknown>;
  try {
    const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error();
    body = decoded;
  } catch {
    throw new InboundEventError("Event body must be a JSON object");
  }
  const bodyDigest = hex(await crypto.subtle.digest("SHA-256", raw));
  let ignored = false;
  if (filter.provider === "github") {
    delivery = bodyDigest;
    ignored =
      record(body.repository).full_name !== filter.repository ||
      Boolean(filter.action && body.action !== filter.action);
  } else if (filter.provider === "slack") {
    if (
      body.type === "url_verification" &&
      typeof body.challenge === "string" &&
      body.challenge.length <= 2000
    )
      return {
        id: bodyDigest,
        digest: bodyDigest,
        body: {},
        challenge: body.challenge,
        ignored: true
      };
    const event = record(body.event);
    if (typeof body.event_id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/u.test(body.event_id))
      throw new InboundEventError("Missing Slack event ID");
    delivery = body.event_id;
    ignored =
      body.type !== "event_callback" ||
      body.team_id !== filter.teamId ||
      event.channel !== filter.channelId ||
      Boolean(event.bot_id || event.subtype || event.hidden) ||
      !["message", "app_mention"].includes(String(event.type));
  } else ignored = Boolean(filter.eventType && body.type !== filter.eventType);
  return { id: delivery, digest: bodyDigest, body, ignored };
}
