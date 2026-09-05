import { eventTriggerInput } from "../domain/events";
import { boundedBody, InboundEventError } from "../services/inbound-events";
import { json, pathMatch, readJson, workspace } from "./common";

export async function handleInboundEvent(request: Request, env: Env): Promise<Response | null> {
  const match = pathMatch(new URL(request.url).pathname, /^\/events\/([0-9a-f-]{36})$/u);
  if (!match?.[0]) return null;
  if (request.method !== "POST") return json({ error: "Use POST" }, 405, { Allow: "POST" });
  try {
    const raw = await boundedBody(request);
    const allowed = [
      "x-hub-signature-256",
      "x-slack-signature",
      "x-slack-request-timestamp",
      "x-hqbot-timestamp",
      "x-hqbot-delivery",
      "x-hqbot-signature"
    ];
    const headers = Object.fromEntries(
      allowed.map((name) => [name, request.headers.get(name) ?? ""])
    );
    const result = await (await workspace(env)).receiveInboundEvent(match[0], raw, headers);
    return json(
      result.body,
      result.status,
      result.status === 503 ? { "Retry-After": "60" } : undefined
    );
  } catch (cause) {
    return json(
      { error: cause instanceof InboundEventError ? cause.message : "Event could not be accepted" },
      cause instanceof InboundEventError ? cause.status : 503
    );
  }
}
export async function handleEventSettings(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = pathMatch(url.pathname, /^\/api\/event-triggers\/([^/]+)$/u);
  if (url.pathname !== "/api/event-triggers" && !match) return null;
  const agent = await workspace(env);
  try {
    if (match?.[0]) {
      if (request.method === "DELETE")
        return json({ deleted: await agent.deleteEventTrigger(match[0]) });
      if (request.method === "GET")
        return json({ events: await agent.eventTriggerHistory(match[0]) });
    } else {
      if (request.method === "GET")
        return json({
          triggers: await agent.listEventTriggers(url.searchParams.get("routineId") ?? "")
        });
      if (request.method === "POST")
        return json(await agent.saveEventTrigger(eventTriggerInput.parse(await readJson(request))));
    }
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : "The trigger change failed" },
      400
    );
  }
  return json({ error: "Unsupported trigger action" }, 400);
}
