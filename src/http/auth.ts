import {
  cleanString,
  cookieValue,
  json,
  readJson,
  requireSameOrigin,
  sessionCookie,
  workspace
} from "./common";

function password(body: Record<string, unknown>): string {
  const value = cleanString(body, "password", 128);
  if (value.length < 12) throw new Error("password must contain at least 12 characters");
  return value;
}

async function digest(value: string): Promise<Uint8Array> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(result);
}

async function secretMatches(actual: string, expected: string): Promise<boolean> {
  if (actual.length < 24 || expected.length < 24) return false;
  const [left, right] = await Promise.all([digest(actual), digest(expected)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function loginAttemptKey(request: Request): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const value = await digest(`hqbot-login:${address}`);
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function handleAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/auth/")) return null;
  const agent = await workspace(env);

  if (request.method === "GET" && url.pathname === "/api/auth/status") {
    const token = cookieValue(request);
    return json({
      configured: await agent.hasOwner(),
      authenticated: Boolean(token && (await agent.validateOwnerSession(token)))
    });
  }

  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (request.method === "POST" && url.pathname === "/api/auth/bootstrap") {
    if (await agent.hasOwner()) return json({ error: "HQBot already has an owner" }, 409);
    const body = await readJson(request);
    if (!(await secretMatches(cleanString(body, "setupCode", 256), env.HQBOT_SETUP_TOKEN))) {
      return json({ error: "The one-time setup code is incorrect" }, 403);
    }
    const token = await agent.bootstrapOwner(cleanString(body, "username", 80), password(body));
    return json({ authenticated: true }, 201, { "Set-Cookie": sessionCookie(token) });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(request);
    const result = await agent.loginOwner(
      cleanString(body, "username", 80),
      password(body),
      await loginAttemptKey(request)
    );
    if (result.limited) {
      return json({ error: "Too many sign-in attempts. Try again in 15 minutes" }, 429, {
        "Retry-After": "900"
      });
    }
    if (!result.token) return json({ error: "The username or password is incorrect" }, 401);
    return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie(result.token) });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = cookieValue(request);
    if (token) await agent.logoutOwner(token);
    return json({ authenticated: false }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }

  return json({ error: "Not found" }, 404);
}
