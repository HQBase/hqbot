import { json } from "./common";

export async function handleArtifacts(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || !url.pathname.startsWith("/api/artifacts/")) return null;

  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice("/api/artifacts/".length));
  } catch {
    return json({ error: "Invalid artifact path" }, 400);
  }
  if (
    (!key.startsWith("tasks/") && !key.startsWith("files/") && !key.startsWith("computer/")) ||
    key.includes("..") ||
    key.includes("\\")
  ) {
    return json({ error: "Invalid artifact path" }, 400);
  }
  const object = await env.ARTIFACTS.get(key);
  if (!object) return json({ error: "Artifact not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  if (key.startsWith("files/")) headers.set("Content-Disposition", "attachment");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
