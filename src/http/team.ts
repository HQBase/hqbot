import { z } from "zod";
import type { Principal } from "../domain/team";
import { handleBots } from "./bots";
import { json, pathMatch, readJson, requireSameOrigin, teammate, workspace } from "./common";
import { handleMessages } from "./messages";
import { handleProjects } from "./projects";

export async function handleTeam(
  request: Request,
  env: Env,
  user: Principal
): Promise<Response | null> {
  const url = new URL(request.url);
  const agent = await workspace(env);
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    if (url.pathname === "/api/team/policy" && user.role === "owner") {
      if (request.method === "GET") return json({ policy: await agent.getAdminPolicy() });
      if (request.method === "POST") {
        const policy = await agent.saveAdminPolicy(user.id, await readJson(request));
        if (policy.mode === "connectors-only")
          for (const bot of await agent.listBots())
            await agent.stopBot(bot.id, "The owner changed the network policy to connectors only");
        return json({ policy });
      }
    }
    if (url.pathname === "/api/team/workspace" && request.method === "GET")
      return json(await agent.teamWorkspace(user.id));
    if (url.pathname === "/api/team/admin" && request.method === "GET")
      return json(await agent.teamAdministration(user.id));
    if (url.pathname === "/api/team/invitations" && request.method === "POST")
      return json(await agent.inviteTeamMember(user.id, await readJson(request)), 201);
    const invite = pathMatch(url.pathname, /^\/api\/team\/invitations\/([^/]+)$/u);
    if (invite?.[0] && request.method === "DELETE") {
      await agent.revokeTeamInvite(user.id, invite[0]);
      return json({ revoked: true });
    }
    const member = pathMatch(url.pathname, /^\/api\/team\/members\/([^/]+)$/u);
    if (member?.[0] && request.method === "PATCH") {
      await agent.updateTeamMember(user.id, member[0], await readJson(request));
      return json({ saved: true });
    }
    const bot = pathMatch(url.pathname, /^\/api\/team\/bots\/([^/]+)(?:\/(messages|stop))?$/u);
    if (bot?.[0]) {
      if (!(await agent.canAccessBot(user.id, bot[0], request.method !== "GET")))
        return json({ error: "You do not have access to this teammate" }, 403);
      const peer = await teammate(env, bot[0]);
      if (request.method === "GET" && !bot[1])
        return json({
          messages: await peer.teamConversation(),
          files: (await agent.listFiles(bot[0])).map((file) => ({
            ...file,
            botId: bot[0] as string
          }))
        });
      if (request.method === "POST" && bot[1] === "messages") {
        const input = z
          .object({ id: z.uuid(), prompt: z.string().trim().min(1).max(12000) })
          .parse(await readJson(request));
        const result = await peer.submitTeamChat(user.id, input);
        await agent.recordAccessAudit(user.id, "work.submit", bot[0]);
        return json(result, 202);
      }
      if (request.method === "POST" && bot[1] === "stop") {
        await agent.stopBot(bot[0], `Workspace member ${user.id} stopped this teammate`);
        await agent.recordAccessAudit(user.id, "work.stop", bot[0]);
        return json({ stopped: true });
      }
    }
    if (user.role !== "owner") {
      const file = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/files\/([^/]+)$/u);
      if (file?.[0] && request.method === "GET" && (await agent.canAccessBot(user.id, file[0])))
        return handleBots(request, env);
      const project = pathMatch(url.pathname, /^\/api\/projects\/([^/]+)\/messages$/u);
      if (
        project?.[0] &&
        (await agent.canAccessProject(user.id, project[0], request.method !== "GET"))
      )
        return handleProjects(request, env);
      if (url.pathname === "/api/discussions") {
        const source =
          request.method === "GET"
            ? Object.fromEntries(url.searchParams)
            : await readJson(request.clone() as Request);
        const allowed =
          source.kind === "bot"
            ? await agent.canAccessBot(user.id, String(source.id), request.method !== "GET")
            : source.kind === "project" &&
              (await agent.canAccessProject(user.id, String(source.id), request.method !== "GET"));
        if (allowed) return handleMessages(request, env);
      }
      return json({ error: "This action requires owner access" }, 403);
    }
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : "The team action failed" }, 400);
  }
  return null;
}
