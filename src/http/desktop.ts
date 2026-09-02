import { connectLinuxDesktop, teammateSandbox } from "../runtime/desktop";
import { json, pathMatch, readJson, requireActiveTeammate, teammate, workspace } from "./common";

function sameOriginWebSocket(request: Request): boolean {
  return (
    request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
    request.headers.get("origin") === new URL(request.url).origin
  );
}

export async function handleDesktop(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const socket = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/desktop\/ws$/u);
  const desktop = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/desktop$/u);
  const botId = socket?.[0] ?? desktop?.[0];
  if (!botId) return null;

  const workspaceAgent = await workspace(env);
  const unavailable = await requireActiveTeammate(workspaceAgent, botId);
  if (unavailable) return unavailable;
  const peer = await teammate(env, botId);

  if (request.method === "GET" && desktop) {
    return json(await peer.getComputerStatus());
  }
  if (request.method === "PATCH" && desktop) {
    const body = await readJson(request);
    if (typeof body.ownerControl === "boolean") {
      if (body.ownerControl) {
        const policy = await workspaceAgent.checkSpendPolicy(botId, null);
        if (!policy.allowed) {
          const status = await peer.getComputerStatus();
          if (status.ownerControl) await peer.setComputerControl(false);
          return json({ error: policy.reason }, 429);
        }
        const status = await peer.renewComputerControl();
        return status ? json(status) : json({ error: "Ask the teammate to give you control" }, 409);
      }
      return json(await peer.setComputerControl(false));
    }
    return json({ error: "ownerControl is required" }, 400);
  }
  if (request.method === "GET" && socket) {
    if (!sameOriginWebSocket(request)) {
      return json({ error: "A same-origin WebSocket is required" }, 403);
    }
    const status = await peer.getComputerStatus();
    if (!status.running) return json({ error: "The computer is not running" }, 409);
    const policy = await workspaceAgent.checkSpendPolicy(botId, null);
    if (!policy.allowed) return json({ error: policy.reason }, 429);
    return connectLinuxDesktop(teammateSandbox(env, botId), botId, request);
  }
  return json({ error: "Method not allowed" }, 405, {
    Allow: desktop ? "GET, PATCH" : "GET"
  });
}
