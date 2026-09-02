import { json } from "./common";

export async function artifactResponse(
  env: Env,
  key: string,
  options: { download: boolean; name?: string }
): Promise<Response> {
  const object = await env.ARTIFACTS.get(key);
  if (!object) return json({ error: "Artifact not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const contentType = headers.get("Content-Type") ?? "application/octet-stream";
  const disposition =
    options.download || !contentType.startsWith("image/") ? "attachment" : "inline";
  const encodedName = encodeURIComponent(options.name ?? key.split("/").at(-1) ?? "file");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", `${disposition}; filename*=UTF-8''${encodedName}`);
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

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
    (!key.startsWith("tasks/") && !key.startsWith("computer/")) ||
    key.includes("..") ||
    key.includes("\\")
  ) {
    return json({ error: "Invalid artifact path" }, 400);
  }
  return artifactResponse(env, key, { download: url.searchParams.get("download") === "1" });
}
