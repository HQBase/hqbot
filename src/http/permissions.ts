import { permissionRuleInput } from "../domain/permissions";
import {
  cleanString,
  json,
  pathMatch,
  readJson,
  requireActiveTeammate,
  teammate,
  workspace
} from "./common";

export async function handlePermissions(request: Request, env: Env): Promise<Response | null> {
  const match = pathMatch(
    new URL(request.url).pathname,
    /^\/api\/bots\/([^/]+)\/permission-rules$/u
  );
  if (!match?.[0]) return null;
  const unavailable = await requireActiveTeammate(await workspace(env), match[0]);
  if (unavailable) return unavailable;
  const peer = await teammate(env, match[0]);
  if (request.method === "GET")
    return json({
      rules: await peer.listPermissionRules(),
      connections: await peer.listPermissionActions()
    });
  const body = await readJson(request);
  if (request.method === "POST") {
    const parsed = permissionRuleInput.safeParse(body);
    if (!parsed.success)
      return json({ error: parsed.error.issues.map((issue) => issue.message).join(". ") }, 400);
    return json({ rule: await peer.savePermissionRule(parsed.data) });
  }
  if (request.method === "DELETE")
    return json({ deleted: await peer.deletePermissionRule(cleanString(body, "id", 200)) });
  return json({ error: "Unsupported permission action" }, 400);
}
