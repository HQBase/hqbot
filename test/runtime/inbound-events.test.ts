import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { boundedBody, verifyInboundEvent } from "../../src/services/inbound-events";

const secret = "test-secret-with-at-least-32-bytes";
const now = Date.parse("2026-09-05T12:00:00Z");
const timestamp = String(now / 1000);
const raw = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const sign = (value: string | Uint8Array) =>
  createHmac("sha256", secret).update(value).digest("hex");
const generic = { provider: "generic" as const, eventType: "ticket.created" };
it("authenticates generic bytes, time, and delivery ID before accepting an event", async () => {
  const body = raw({ type: "ticket.created", text: "Café" });
  const headers = new Headers({
    "x-hqbot-delivery": "event-1",
    "x-hqbot-timestamp": timestamp,
    "x-hqbot-signature": `sha256=${sign(`v1:${timestamp}:event-1:${new TextDecoder().decode(body)}`)}`
  });
  expect(await verifyInboundEvent(generic, secret, body, headers, now)).toMatchObject({
    id: "event-1",
    ignored: false
  });
  await expect(
    verifyInboundEvent(generic, secret, body, headers, now + 301000)
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    verifyInboundEvent(generic, secret, body, headers, now - 301000)
  ).rejects.toMatchObject({ status: 401 });
  headers.set("x-hqbot-delivery", "event-2");
  await expect(verifyInboundEvent(generic, secret, body, headers, now)).rejects.toMatchObject({
    status: 401
  });
});
it("uses GitHub's signed body as identity and enforces repository and action filters", async () => {
  const body = raw({ repository: { full_name: "owner/repo" }, action: "opened" });
  const headers = new Headers({
    "x-hub-signature-256": `sha256=${sign(body)}`,
    "x-github-delivery": "first"
  });
  const filter = { provider: "github" as const, repository: "owner/repo", action: "opened" };
  const first = await verifyInboundEvent(filter, secret, body, headers, now);
  headers.set("x-github-delivery", "forged-new-id");
  expect(await verifyInboundEvent(filter, secret, body, headers, now + 86400000)).toEqual(first);
  expect(
    await verifyInboundEvent({ ...filter, repository: "other/repo" }, secret, body, headers, now)
  ).toMatchObject({ ignored: true });
  await expect(
    verifyInboundEvent(
      filter,
      secret,
      raw({ repository: { full_name: "owner/repo" }, action: "closed" }),
      headers,
      now
    )
  ).rejects.toMatchObject({ status: 401 });
});
it("checks the official GitHub signature vector before rejecting non-JSON content", async () => {
  await expect(
    verifyInboundEvent(
      { provider: "github", repository: "o/r", action: "" },
      "It's a Secret to Everybody",
      new TextEncoder().encode("Hello, World!"),
      new Headers({
        "x-hub-signature-256":
          "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"
      }),
      now
    )
  ).rejects.toMatchObject({ status: 400, message: "Event body must be a JSON object" });
});
it("handles signed Slack challenges and selected human messages while ignoring bot loops", async () => {
  const filter = { provider: "slack" as const, teamId: "T123", channelId: "C123" };
  const verify = (value: unknown) => {
    const body = raw(value);
    return verifyInboundEvent(
      filter,
      secret,
      body,
      new Headers({
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": `v0=${sign(`v0:${timestamp}:${new TextDecoder().decode(body)}`)}`
      }),
      now
    );
  };
  expect(await verify({ type: "url_verification", challenge: "challenge" })).toMatchObject({
    challenge: "challenge",
    ignored: true
  });
  const value = {
    type: "event_callback",
    team_id: "T123",
    event_id: "Ev123",
    event: { type: "message", channel: "C123", text: "Help", user: "U123" }
  };
  expect(await verify(value)).toMatchObject({ id: "Ev123", ignored: false });
  expect(await verify({ ...value, event: { ...value.event, bot_id: "B123" } })).toMatchObject({
    ignored: true
  });
  expect(await verify({ ...value, team_id: "T456" })).toMatchObject({ ignored: true });
  expect(await verify({ ...value, event: { ...value.event, channel: "C456" } })).toMatchObject({
    ignored: true
  });
});
it("stops an oversized streaming body even when content-length is absent", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(32769));
    },
    cancel() {
      cancelled = true;
    }
  });
  const request = new Request("https://hqbot.test/events/id", {
    method: "POST",
    body,
    duplex: "half"
  } as RequestInit);
  await expect(boundedBody(request)).rejects.toMatchObject({ status: 413 });
  expect(cancelled).toBe(true);
});
