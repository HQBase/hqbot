import type { IntegrationApproval } from "../domain/actions";
import type { ConversationAttentionItem, OwnerAttention } from "../domain/attention";
import {
  cleanString,
  json,
  pathMatch,
  readJson,
  requireActiveTeammate,
  teammate,
  workspace
} from "./common";

export async function handleAttention(request: Request, env: Env): Promise<Response | null> {
  const route = pathMatch(new URL(request.url).pathname, /^\/api\/bots\/([^/]+)\/attention$/u);
  if (!route?.[0]) return null;
  const originBotId = route[0];
  const agent = await workspace(env);
  const unavailable = await requireActiveTeammate(agent, originBotId);
  if (unavailable) return unavailable;
  const work = await agent.teamWorkForBot(originBotId);
  const ids = new Set([originBotId]);
  if (work && ["active", "waiting"].includes(work.state)) {
    for (const assignment of work.assignments)
      if (["queued", "submitted"].includes(assignment.state)) ids.add(assignment.botId);
  }
  if (request.method === "GET") {
    const items = await Promise.all(
      [...ids].map(async (botId): Promise<ConversationAttentionItem | null> => {
        const bot = await agent.getBot(botId);
        if (!bot || bot.hidden) return null;
        try {
          return {
            botId,
            name: bot.name,
            ...((await (
              await teammate(env, botId)
            ).getOwnerAttention()) as unknown as OwnerAttention)
          };
        } catch {
          return {
            botId,
            name: bot.name,
            error: "Requests could not load. Reconnecting…",
            computerApprovals: [],
            integrationApprovals: [],
            handoff: null
          };
        }
      })
    );
    return json({ items: items.filter(Boolean) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(request);
  const botId = cleanString(body, "botId", 100);
  if (!ids.has(botId))
    return json({ error: "This teammate is no longer working on this task" }, 409);
  const inactive = await requireActiveTeammate(agent, botId);
  if (inactive) return inactive;
  const peer = await teammate(env, botId);
  const id = cleanString(body, "id", 1000);
  if (body.kind === "continue") return json(await peer.completeOwnerHandoff(id));
  if (body.kind === "reconnect") return json(await peer.reconnectOwnerHandoff(id));
  if (typeof body.approved !== "boolean")
    return json({ error: "An approval decision is required" }, 400);
  const hash = cleanString(body, "inputHash", 100);
  if (body.kind === "computer") {
    const result: unknown = await peer.resolveComputerApproval(id, hash, body.approved);
    if (result && typeof result === "object" && "status" in result && result.status === "error")
      return json(
        { error: "The action could not complete. Check the conversation before trying again." },
        409
      );
    return json({ saved: true });
  }
  if (body.kind === "integration") {
    const pending = (
      (await peer.listIntegrationApprovals()) as unknown as IntegrationApproval[]
    ).find((item) => item.executionId === id && item.seq === body.seq && item.inputHash === hash);
    if (!pending) return json({ error: "This approval is stale. Refresh before deciding." }, 409);
    if (body.approved) await peer.approveIntegrationAction(id, pending.seq, hash);
    else await peer.rejectIntegrationAction(id, pending.seq);
    return json({ saved: true });
  }
  return json({ error: "Unknown conversation action" }, 400);
}
