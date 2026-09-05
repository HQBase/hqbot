import { z } from "zod";
import { parseTemplate } from "../domain/templates";
import { json, pathMatch, readJson, workspace } from "./common";

export async function handleTemplates(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/templates")) return null;
  const agent = await workspace(env);
  try {
    if (url.pathname === "/api/templates/shares" && request.method === "GET")
      return json({ shares: await agent.listTemplateShares() });
    const share = pathMatch(url.pathname, /^\/api\/templates\/shares\/([^/]+)$/u);
    if (share?.[0] && request.method === "DELETE") {
      await agent.revokeTemplate(share[0]);
      return json({ revoked: true });
    }
    if (request.method !== "POST") return null;
    const body = await readJson(request);
    if (url.pathname === "/api/templates/export") {
      const input = z
        .object({
          botId: z.string().max(200),
          skillIds: z.array(z.string().max(200)).max(30),
          routineIds: z.array(z.string().max(200)).max(20)
        })
        .parse(body);
      return json({
        template: await agent.exportTemplate(input.botId, input.skillIds, input.routineIds)
      });
    }
    const id = z.uuid().parse(body.id);
    const template = parseTemplate(body.template);
    if (url.pathname === "/api/templates/import")
      return json({ teammate: await agent.importTemplate(id, template) }, 201);
    if (url.pathname === "/api/templates/publish")
      return json({ share: await agent.publishTemplate(id, template) }, 201);
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : "The template could not be saved" },
      400
    );
  }
  return null;
}
export async function handlePublicTemplate(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = pathMatch(url.pathname, /^\/api\/public\/templates\/([^/]+)$/u);
  if (!match) return null;
  if (request.method !== "GET" || !z.uuid().safeParse(match[0]).success)
    return json({ error: "Template not found" }, 404);
  const template = await (await workspace(env)).readPublicTemplate(match[0] as string);
  if (!template) return json({ error: "This template link is no longer available" }, 404);
  if (url.searchParams.get("download") === "1")
    return json(template, 200, {
      "Content-Disposition": "attachment; filename=hqbot-template.json"
    });
  const escapeHtml = (value: string) =>
    value.replace(
      /[&<>"']/gu,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
    );
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(template.profile.name)} · HQBot template</title><style>body{font:16px system-ui;max-width:760px;margin:48px auto;padding:0 24px;color:#172026;background:#fafbf9}p,pre{line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef1ed;padding:20px;border-radius:16px}a{display:inline-block;padding:12px 18px;background:#174c35;color:white;border-radius:10px;text-decoration:none}</style></head><body><p>HQBot · Shared teammate</p><h1>${escapeHtml(template.profile.name)}</h1><p>${escapeHtml(template.profile.description)}</p><p>${template.skills.length} skills · ${template.routines.length} paused routines</p><a href="?download=1">Download template</a><p>In your HQBot deployment, open Library → Templates → Import. Review the instructions before use. Imported skills start as drafts.</p><details><summary>Review the complete template</summary><pre>${escapeHtml(JSON.stringify(template, null, 2))}</pre></details></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      }
    }
  );
}
