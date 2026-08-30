import { getAgentByName } from "agents";

import type { HQBotAgent } from "../agent";
import type { HQBotTeammate } from "../teammate";

export const sessionCookieName = "__Host-hqbot_session";

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, { status, headers: { ...jsonHeaders, ...headers } });
}

export function workspace(env: Env): Promise<DurableObjectStub<HQBotAgent>> {
  return getAgentByName<Env, HQBotAgent>(env.HQBOT_AGENT, env.HQBOT_ID);
}

export function teammate(env: Env, botId: string): Promise<DurableObjectStub<HQBotTeammate>> {
  return getAgentByName<Env, HQBotTeammate>(env.HQBOT_TEAMMATE, botId);
}

export function cookieValue(request: Request, name = sessionCookieName): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export function sessionCookie(value: string, maxAge = 2_592_000): string {
  return `${sessionCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${maxAge}`;
}

export async function requireOwner(request: Request, env: Env): Promise<Response | null> {
  const token = cookieValue(request);
  if (!token || !(await (await workspace(env)).validateOwnerSession(token))) {
    return json({ error: "Owner sign-in is required" }, 401);
  }
  return null;
}

export function requireSameOrigin(request: Request): Response | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (origin && origin !== expected)
    return json({ error: "Cross-origin requests are not allowed" }, 403);
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) {
    return json({ error: "Cross-origin requests are not allowed" }, 403);
  }
  return null;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 100_000) throw new Error("Request body is too large");
  const raw = await request.text();
  if (raw.length > 100_000) throw new Error("Request body is too large");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function cleanString(body: Record<string, unknown>, key: string, limit: number): string {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  if (!value || value.length > limit) {
    throw new Error(`${key} must contain 1 to ${limit} characters`);
  }
  return value;
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
  limit: number
): string | undefined {
  return body[key] === undefined ? undefined : cleanString(body, key, limit);
}

export function pathMatch(path: string, pattern: RegExp): string[] | null {
  const match = pattern.exec(path);
  if (!match) return null;
  try {
    return match.slice(1).map(decodeURIComponent);
  } catch {
    return null;
  }
}
