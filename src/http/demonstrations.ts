import { demonstrationInput } from "../domain/demonstrations";
import { json, pathMatch, readJson, requireActiveTeammate, workspace } from "./common";
export async function handleDemonstrations(request: Request, env: Env): Promise<Response | null> {
  const match = pathMatch(
    new URL(request.url).pathname,
    /^\/api\/bots\/([^/]+)\/demonstrations(?:\/([^/]+)\/retry)?$/u
  );
  if (!match?.[0]) return null;
  const agent = await workspace(env);
  const unavailable = await requireActiveTeammate(agent, match[0]);
  if (unavailable) return unavailable;
  try {
    if (request.method === "GET" && !match[1])
      return json({ demonstrations: await agent.listDemonstrations(match[0]) });
    if (request.method === "POST") {
      if (match[1]) {
        await agent.retryDemonstration(match[1], match[0]);
        return json({ queued: true }, 202);
      }
      return json(
        {
          demonstration: await agent.saveDemonstration(
            demonstrationInput.parse({ ...(await readJson(request)), botId: match[0] })
          )
        },
        202
      );
    }
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : "The demonstration could not be saved" },
      400
    );
  }
  return json({ error: "Unsupported demonstration action" }, 400);
}
