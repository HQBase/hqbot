import { z } from "zod";
import { projectInput } from "../domain/projects";
import { json, pathMatch, readJson, workspace } from "./common";

const messageInput = z.object({
  id: z.string().min(1).max(200),
  content: z.string().min(1).max(12000),
  recipientIds: z.array(z.string().min(1).max(200)).min(1).max(6),
  parentId: z.string().max(200).optional()
});
export async function handleProjects(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/projects")) return null;
  const agent = await workspace(env);
  try {
    if (url.pathname === "/api/projects") {
      if (request.method === "GET") return json({ projects: await agent.listProjects() });
      if (request.method === "POST")
        return json({
          project: await agent.saveProject(projectInput.parse(await readJson(request)))
        });
    }
    const match = pathMatch(url.pathname, /^\/api\/projects\/([^/]+)(?:\/(messages|resources))?$/u);
    if (!match?.[0]) return null;
    const project = (await agent.listProjects()).find((item) => item.id === match[0]);
    if (!project) return json({ error: "Project not found" }, 404);
    if (!match[1] && request.method === "DELETE")
      return json({ deleted: await agent.deleteProject(project.id) });
    if (match[1] === "messages") {
      if (request.method === "GET")
        return json({
          messages: await agent.projectMessages(
            project.id,
            undefined,
            url.searchParams.get("before") ?? undefined,
            {
              query: (url.searchParams.get("query") ?? "").slice(0, 200),
              thread: (url.searchParams.get("thread") ?? "").slice(0, 300)
            }
          )
        });
      if (request.method === "POST")
        return json(
          {
            message: await agent.sendCollaboration(null, {
              ...messageInput.parse(await readJson(request)),
              projectId: project.id
            })
          },
          202
        );
    }
    if (match[1] === "resources" && request.method === "GET" && project.botIds[0])
      return json(await agent.projectResources(project.id, project.botIds[0]));
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : "The project change failed" },
      400
    );
  }
  return json({ error: "Unsupported project action" }, 400);
}
