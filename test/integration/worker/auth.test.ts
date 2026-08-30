import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";

import { schemaMigrations } from "../../../src/domain/schema";

const origin = "http://hqbot.test";
const setupCode = "integration-setup-code-32-bytes";
const owner = { username: "owner", password: "correct horse battery staple", setupCode };
const server = createTestHarness({
  workers: [
    {
      configPath: "./test/integration/worker/wrangler.test.jsonc",
      secrets: {
        HQBOT_CONNECTION_KEY: "integration-connection-key-32-bytes",
        HQBOT_SETUP_TOKEN: setupCode
      }
    }
  ]
});

function request(path: string, init?: Parameters<typeof server.fetch>[1]) {
  return server.fetch(`${origin}${path}`, init);
}

function post(path: string, body?: unknown, cookie?: string) {
  return request(path, {
    method: "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: origin
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function cookie(response: Awaited<ReturnType<typeof request>>): string {
  const value = response.headers.get("Set-Cookie");
  expect(value).toContain("__Host-hqbot_session=");
  return value?.split(";", 1)[0] ?? "";
}

beforeAll(async () => {
  await server.listen();
});

beforeEach(async () => {
  await server.reset();
});

afterAll(async () => {
  await server.close();
});

describe("HQBot Worker authentication", () => {
  it("reports health and protects owner-only routes", async () => {
    const health = await request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      configured: false,
      ownerConfigured: false
    });

    const snapshot = await request("/api/snapshot");
    expect(snapshot.status).toBe(401);
    expect(await snapshot.json()).toEqual({ error: "Owner sign-in is required" });

    const agent = await request("/agents/hqbot-agent/hqbot");
    expect(agent.status).toBe(401);
    expect(await agent.json()).toEqual({ error: "Owner sign-in is required" });
    expect(await server.getWorker().listDurableObjectIds("HQBOT_AGENT")).toHaveLength(1);
  });

  it("supports first-owner bootstrap, login, and logout", async () => {
    const rejected = await post("/api/auth/bootstrap", { ...owner, setupCode: "wrong" });
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toEqual({ error: "The one-time setup code is incorrect" });

    const bootstrap = await post("/api/auth/bootstrap", owner);
    const setCookie = bootstrap.headers.get("Set-Cookie");
    const bootstrapBody = await bootstrap.clone().json();
    expect(bootstrap.status, JSON.stringify(bootstrapBody)).toBe(201);
    expect(await bootstrap.json()).toEqual({ authenticated: true });
    expect(setCookie).toContain("__Host-hqbot_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Max-Age=2592000");
    const bootstrapSession = cookie(bootstrap);

    const storage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    expect(await storage.exec("SELECT username FROM owner WHERE id = 'owner'")).toEqual([
      { username: owner.username }
    ]);
    expect(await storage.exec("SELECT iterations FROM owner WHERE id = 'owner'")).toEqual([
      { iterations: 100_000 }
    ]);

    const snapshot = await request("/api/snapshot", { headers: { Cookie: bootstrapSession } });
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      bots: [],
      realtime: { url: "/agents/hqbot-agent/hqbot" }
    });

    const repeat = await post("/api/auth/bootstrap", owner);
    expect(repeat.status).toBe(409);
    expect(await repeat.json()).toEqual({ error: "HQBot already has an owner" });

    expect((await post("/api/auth/logout", undefined, bootstrapSession)).status).toBe(200);
    const login = await post("/api/auth/login", owner);
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ authenticated: true });
    const loginSession = cookie(login);
    expect((await request("/api/snapshot", { headers: { Cookie: loginSession } })).status).toBe(
      200
    );

    const logout = await post("/api/auth/logout", undefined, loginSession);
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ authenticated: false });
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await request("/api/snapshot", { headers: { Cookie: loginSession } })).status).toBe(
      401
    );
  });

  it("limits repeated sign-in failures before another password check", async () => {
    expect((await post("/api/auth/bootstrap", owner)).status).toBe(201);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await post("/api/auth/login", {
        username: owner.username,
        password: "incorrect password value"
      });
      expect(response.status).toBe(401);
    }

    const limited = await post("/api/auth/login", owner);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("900");
  });

  it("updates an existing version four workspace before serving it", async () => {
    const storage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    await storage.exec(
      "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
    );
    for (const migration of schemaMigrations.slice(0, 4)) {
      for (const statement of migration.statements) await storage.exec(statement);
      await storage.exec(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        migration.version,
        new Date().toISOString()
      );
    }

    expect((await request("/health")).status).toBe(200);
    expect(await storage.exec("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 }
    ]);
    expect(await storage.exec("SELECT name FROM pragma_table_info('owner') ORDER BY cid")).toEqual(
      expect.arrayContaining([{ name: "username" }, { name: "password_hash" }])
    );
  });

  it("creates and updates a teammate in the workspace Durable Object", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const created = await post("/api/bots", { brief: "Be my product research teammate." }, session);
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { teammate: { id: string; name: string } };
    expect(createdBody.teammate.name).toBe("Research");

    const updated = await request(`/api/bots/${createdBody.teammate.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: session,
        Origin: origin
      },
      body: JSON.stringify({ dailyBudgetUsd: 3.5, pinned: true })
    });
    expect(updated.status).toBe(200);

    const snapshot = await request(`/api/snapshot?botId=${createdBody.teammate.id}`, {
      headers: { Cookie: session }
    });
    expect(await snapshot.json()).toMatchObject({
      selectedBot: {
        id: createdBody.teammate.id,
        dailyBudgetUsd: 3.5,
        pinned: true,
        modelId: "@cf/zai-org/glm-5.3-flash"
      }
    });
  });

  it("blocks new work for an archived teammate and still permits restore", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const created = await post("/api/bots", { brief: "Research product questions." }, session);
    const { teammate } = (await created.json()) as { teammate: { id: string } };
    const storage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    const now = new Date().toISOString();
    await storage.exec("UPDATE bots SET hidden = 1 WHERE id = ?", teammate.id);
    await storage.exec(
      `INSERT INTO routines (
        id, bot_id, name, prompt, interval_minutes, active, next_run_at, created_at, updated_at
      ) VALUES (?, ?, 'Daily brief', 'Prepare a brief', 60, 0, ?, ?, ?)`,
      "routine-1",
      teammate.id,
      now,
      now,
      now
    );
    await storage.exec(
      `INSERT INTO tasks (
        id, bot_id, source, status, prompt, created_at, updated_at
      ) VALUES ('email-task', ?, 'email', 'awaiting_approval', 'Draft a reply', ?, ?)`,
      teammate.id,
      now,
      now
    );

    const blocked = [
      post(`/api/bots/${teammate.id}/tasks`, { prompt: "Research this" }, session),
      post(`/api/bots/${teammate.id}/files`, { file: "ignored" }, session),
      post(`/api/bots/${teammate.id}/memories`, { content: "Remember this" }, session),
      post(
        `/api/bots/${teammate.id}/skills`,
        { name: "Research", description: "Find facts", instructions: "Use primary sources" },
        session
      ),
      post(
        `/api/bots/${teammate.id}/routines`,
        { name: "New brief", prompt: "Prepare it", intervalMinutes: 60 },
        session
      ),
      post(`/api/bots/${teammate.id}/routines/routine-1/run`, undefined, session),
      request(`/api/bots/${teammate.id}/routines/routine-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: session, Origin: origin },
        body: JSON.stringify({ active: true })
      }),
      post(
        `/api/bots/${teammate.id}/connections/hqbase`,
        { origin: "https://hqbase.example.com", token: "mailbox-token" },
        session
      ),
      post("/api/tasks/email-task/approval", { approved: true }, session),
      request(`/api/bots/${teammate.id}/live-view`, { headers: { Cookie: session } })
    ];

    for (const response of await Promise.all(blocked)) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "Restore this teammate before you start new work"
      });
    }

    const restored = await request(`/api/bots/${teammate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: session, Origin: origin },
      body: JSON.stringify({ hidden: false })
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ teammate: { id: teammate.id, hidden: false } });
  });
});
