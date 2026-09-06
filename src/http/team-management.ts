import { teamPolicyInput } from "../domain/team-policy";
import { teamWorkInput } from "../domain/team-work";
import { listHQBotModels } from "../runtime/model-catalog";
import { json, pathMatch, readJson, requireActiveTeammate, workspace } from "./common";

export async function handleTeamManagement(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const policyRoute = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/team-management$/u);
  const updateRoute = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/team-work\/updates$/u);
  const botId = policyRoute?.[0] ?? updateRoute?.[0];
  if (!botId) return null;
  const agent = await workspace(env);
  const unavailable = await requireActiveTeammate(agent, botId);
  if (unavailable) return unavailable;
  if (policyRoute && request.method === "GET")
    return json({
      policy: await agent.getTeamPolicy(botId),
      models: (await listHQBotModels(env.AI)).filter((model) => model.rates)
    });
  if (policyRoute && request.method === "PATCH") {
    const parsed = teamPolicyInput.safeParse(await readJson(request));
    if (!parsed.success)
      return json(
        { error: "Check the models and team limits. The default model must be allowed." },
        400
      );
    const models = await listHQBotModels(env.AI);
    if (
      parsed.data.allowedModelIds.some(
        (id) => !models.some((model) => model.id === id && model.rates)
      )
    )
      return json(
        { error: "Choose models with known prices so the shared budget can be enforced." },
        400
      );
    const policy = await agent.saveTeamPolicy(botId, parsed.data);
    await agent.recordAccessAudit("owner", "team.policy.update", botId);
    return json({ policy });
  }
  if (updateRoute && request.method === "POST") {
    const body = await readJson(request);
    const parsed = teamWorkInput.safeParse(body);
    if (
      !parsed.success ||
      !["check_in", "redirect"].includes(parsed.data.action) ||
      typeof body.workId !== "string"
    )
      return json({ error: "A task, assignment and message are required." }, 400);
    const work = await agent.teamWorkForBot(botId, body.workId);
    if (!work) return json({ error: "Team task not found" }, 404);
    const result = await agent.coordinate(
      work.ownerBotId,
      parsed.data,
      work.id,
      crypto.randomUUID()
    );
    await agent.recordAccessAudit("owner", `team.${parsed.data.action}`, botId);
    return json(result);
  }
  return null;
}
