import { backupKey, listComputerBackups } from "../runtime/computer-backups";
import { artifactResponse } from "./artifacts";
import {
  cleanString,
  json,
  pathMatch,
  readJson,
  requireActiveTeammate,
  teammate,
  workspace
} from "./common";

export async function handleBackups(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/backups(?:\/([^/]+))?$/u);
  if (!match?.[0]) return null;
  const botId = match[0];
  const unavailable = await requireActiveTeammate(await workspace(env), botId);
  if (unavailable) return unavailable;
  const peer = await teammate(env, botId);
  if (request.method === "GET" && match[1])
    return artifactResponse(env, backupKey(botId, match[1]), {
      download: true,
      name: `computer-${match[1]}`
    });
  if (request.method === "GET")
    return json({
      backups: await listComputerBackups(env.ARTIFACTS, botId),
      status: await peer.getComputerStatus()
    });
  if (request.method === "POST") {
    const input = await readJson(request);
    if (input.action === "restore") await peer.restoreComputerBackup(cleanString(input, "id", 200));
    else if (input.action === "save") await peer.saveComputerBackup();
    else return json({ error: "Choose save or restore" }, 400);
    return json({ saved: true });
  }
  return json({ error: "Method not allowed" }, 405);
}
