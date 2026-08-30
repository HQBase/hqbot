import { routeAgentRequest } from "agents";

import { HQBotAgent } from "./agent";
import { handleArtifacts } from "./http/artifacts";
import { handleAuth } from "./http/auth";
import { handleBots } from "./http/bots";
import { json, requireOwner, requireSameOrigin, workspace } from "./http/common";
import { handleResources } from "./http/resources";
import { HQBotTeammate } from "./teammate";

interface AgentRouteMatch {
  className: Extract<keyof Env, string>;
  name: string;
}

export { CodemodeRuntime } from "@cloudflare/codemode";
export { HQBotAgent, HQBotTeammate };

async function authorizeAgent(
  request: Request,
  env: Env,
  route: AgentRouteMatch
): Promise<Response | undefined> {
  const unauthorized = await requireOwner(request, env);
  if (unauthorized) return unauthorized;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Cross-origin agent access is not allowed" }, 403);
  }
  if (route.className === "HQBOT_AGENT" && route.name !== env.HQBOT_ID) {
    return json({ error: "Workspace not found" }, 404);
  }
  if (route.className === "HQBOT_TEAMMATE" && !(await (await workspace(env)).hasBot(route.name))) {
    return json({ error: "Teammate not found" }, 404);
  }
}

async function health(env: Env): Promise<Response> {
  let ownerConfigured = false;
  try {
    ownerConfigured = await (await workspace(env)).hasOwner();
  } catch {
    // A new deployment can report its Worker health while its Durable Object starts.
  }
  return json({
    ok: true,
    configured: Boolean(env.HQBOT_CONNECTION_KEY) && ownerConfigured,
    ownerConfigured,
    version: {
      id: env.CF_VERSION_METADATA.id,
      tag: env.CF_VERSION_METADATA.tag
    }
  });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const unauthorized = await requireOwner(request, env);
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  for (const handler of [handleBots, handleResources, handleArtifacts]) {
    const response = await handler(request, env);
    if (response) return response;
  }
  return json({ error: "Not found" }, 404);
}

async function staticAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self' wss:; font-src 'self'; frame-ancestors 'none'; frame-src https:; img-src 'self' blob: data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'"
  );
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return health(env);

      const auth = await handleAuth(request, env);
      if (auth) return auth;

      const routed = await routeAgentRequest(request, env, {
        onBeforeConnect: (nextRequest, route) => authorizeAgent(nextRequest, env, route),
        onBeforeRequest: (nextRequest, route) => authorizeAgent(nextRequest, env, route)
      });
      if (routed) return routed;

      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      return staticAsset(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "HQBot request failed";
      return json({ error: message }, error instanceof SyntaxError ? 400 : 500);
    }
  }
} satisfies ExportedHandler<Env>;
