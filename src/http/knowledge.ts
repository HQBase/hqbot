import { knowledgeWrite } from "../domain/knowledge";
import { cleanString, json, pathMatch, readJson, requireActiveTeammate, workspace } from "./common";

export async function handleKnowledge(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/knowledge$/u);
  if (!match?.[0]) return null;
  const botId = match[0];
  const agent = await workspace(env);
  if (request.method === "GET") {
    const id = url.searchParams.get("history");
    return id
      ? json({ versions: await agent.knowledgeHistory(botId, id) })
      : json({ items: await agent.listKnowledge(botId) });
  }
  const unavailable = await requireActiveTeammate(agent, botId);
  if (unavailable) return unavailable;
  const body = await readJson(request);
  try {
    if (request.method === "POST") {
      const input = knowledgeWrite.parse(body.entry);
      return json({
        item: await agent.saveKnowledge(botId, cleanString(body, "commandId", 200), input)
      });
    }
    if (request.method === "DELETE" && (body.kind === "memory" || body.kind === "skill"))
      return json({
        forgotten: await agent.forgetKnowledge(botId, body.kind, cleanString(body, "id", 200))
      });
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : "The knowledge change failed" },
      400
    );
  }
  return json({ error: "Unsupported knowledge action" }, 400);
}
