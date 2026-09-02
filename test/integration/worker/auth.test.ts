import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";

import { DEEPSEEK_FALLBACK_MODEL_ID } from "../../../src/domain/models";
import { schemaMigrations } from "../../../src/domain/schema";

const origin = "http://hqbot.test";
const setupCode = "integration-setup-code-32-bytes";
const owner = { username: "owner", password: "correct horse battery staple", setupCode };
const server = createTestHarness({
  workers: [
    {
      configPath: "./test/integration/worker/wrangler.test.jsonc",
      secrets: {
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
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 }
    ]);
    expect(await storage.exec("SELECT name FROM pragma_table_info('owner') ORDER BY cid")).toEqual(
      expect.arrayContaining([{ name: "username" }, { name: "password_hash" }])
    );
    expect(await storage.exec("SELECT name FROM pragma_table_info('tasks') ORDER BY cid")).toEqual(
      expect.arrayContaining([{ name: "wake_at" }, { name: "work_state" }])
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
      body: JSON.stringify({
        dailyBudgetUsd: 3.5,
        maxSteps: 16,
        modelId: DEEPSEEK_FALLBACK_MODEL_ID,
        pinned: true
      })
    });
    expect(updated.status).toBe(200);

    const snapshot = await request(`/api/snapshot?botId=${createdBody.teammate.id}`, {
      headers: { Cookie: session }
    });
    expect(await snapshot.json()).toMatchObject({
      selectedBot: {
        id: createdBody.teammate.id,
        dailyBudgetUsd: 3.5,
        maxSteps: 16,
        pinned: true,
        modelId: DEEPSEEK_FALLBACK_MODEL_ID
      }
    });

    const invalidModel = await request(`/api/bots/${createdBody.teammate.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: session,
        Origin: origin
      },
      body: JSON.stringify({ modelId: "@cf/not-a-model" })
    });
    expect(invalidModel.status).toBe(400);
    expect(await invalidModel.json()).toEqual({
      error: "modelId must be an agent-ready Cloudflare AI model"
    });

    const unlimited = await request(`/api/bots/${createdBody.teammate.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: session,
        Origin: origin
      },
      body: JSON.stringify({ maxSteps: null })
    });
    expect(unlimited.status).toBe(200);
    expect(await unlimited.json()).toMatchObject({ teammate: { maxSteps: null } });

    const invalidMaxSteps = await request(`/api/bots/${createdBody.teammate.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: session,
        Origin: origin
      },
      body: JSON.stringify({ maxSteps: 65 })
    });
    expect(invalidMaxSteps.status).toBe(400);
    expect(await invalidMaxSteps.json()).toEqual({
      error: "maxSteps must be null or an integer from 1 to 64"
    });

    const catalog = await request("/api/models", { headers: { Cookie: session } });
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({
      models: expect.arrayContaining([expect.objectContaining({ id: DEEPSEEK_FALLBACK_MODEL_ID })])
    });
  });

  it("creates routines from one minute and rejects shorter intervals", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const created = await post("/api/bots", { brief: "Run scheduled checks." }, session);
    const { teammate } = (await created.json()) as { teammate: { id: string } };
    const accepted = await post(
      `/api/bots/${teammate.id}/routines`,
      { intervalMinutes: 1, name: "Minute check", prompt: "Check for updates" },
      session
    );
    const acceptedBody = (await accepted.json()) as {
      routine: { botId: string; id: string; intervalMinutes: number; name: string };
    };

    expect(accepted.status, JSON.stringify(acceptedBody)).toBe(201);
    expect(acceptedBody).toMatchObject({
      routine: { botId: teammate.id, intervalMinutes: 1, name: "Minute check" }
    });

    const manualRun = await post(
      `/api/bots/${teammate.id}/routines/${acceptedBody.routine.id}/run`,
      undefined,
      session
    );
    const manualRunBody = (await manualRun.json()) as {
      accepted: boolean;
      submissionId: string;
    };
    expect(manualRun.status).toBe(202);
    expect(manualRunBody).toEqual({
      accepted: true,
      submissionId: expect.stringMatching(`^routine:${acceptedBody.routine.id}:`)
    });

    const workspaceStorage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    expect(await workspaceStorage.exec("SELECT COUNT(*) AS count FROM tasks")).toEqual([
      { count: 0 }
    ]);

    const teammateStorage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_TEAMMATE", { name: teammate.id });
    const submissions = await teammateStorage.exec(
      "SELECT submission_id, messages_json FROM cf_think_submissions WHERE submission_id = ?",
      manualRunBody.submissionId
    );
    expect(submissions).toHaveLength(1);
    expect(String(submissions[0]?.messages_json)).toContain(
      "[hqbot:routine-run]\\nMinute check\\n\\nCheck for updates"
    );

    const rejected = await post(
      `/api/bots/${teammate.id}/routines`,
      { intervalMinutes: 0, name: "Too fast", prompt: "Check constantly" },
      session
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({
      error: "intervalMinutes must be from 1 to 43200"
    });

    for (const removedRoute of [`/api/bots/${teammate.id}/tasks`, "/api/tasks/old-task/stop"]) {
      const response = await post(removedRoute, { prompt: "Do work" }, session);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });

  it("starts a new teammate with one native chat submission", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const created = await post(
      "/api/bots",
      { brief: "hey how are you?", conversation: true },
      session
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      teammate: { id: string; name: string; title: string };
    };
    expect(body.teammate.name).toMatch(/^[A-Z][a-z]+$/u);
    expect(body.teammate.title).toBe(body.teammate.name);
    expect(body.teammate.name).not.toContain("hey how are you?");
    const firstMessage = await post(
      `/api/bots/${body.teammate.id}/messages/initial`,
      { prompt: "hey how are you?" },
      session
    );
    expect(firstMessage.status).toBe(202);
    const submission = (await firstMessage.json()) as {
      accepted: boolean;
      submissionId: string;
    };
    expect(submission).toEqual({ accepted: true, submissionId: `first:${body.teammate.id}` });

    const workspaceStorage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    expect(await workspaceStorage.exec("SELECT COUNT(*) AS count FROM tasks")).toEqual([
      { count: 0 }
    ]);
    expect(
      await workspaceStorage.exec(
        "SELECT name, title, description, brief FROM bots WHERE id = ?",
        body.teammate.id
      )
    ).toEqual([
      {
        name: body.teammate.name,
        title: body.teammate.name,
        description: "A helpful teammate for everyday questions and tasks.",
        brief: "Answer the owner directly. Follow the instructions in the conversation."
      }
    ]);

    const teammateStorage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_TEAMMATE", { name: body.teammate.id });
    const submissions = await teammateStorage.exec(
      "SELECT submission_id, messages_json FROM cf_think_submissions"
    );
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ submission_id: submission.submissionId });
    expect(String(submissions[0]?.messages_json)).toContain("hey how are you?");

    const retry = await post(
      `/api/bots/${body.teammate.id}/messages/initial`,
      { prompt: "hey how are you?" },
      session
    );
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({
      accepted: false,
      submissionId: submission.submissionId,
      status: "error",
      messageApplied: true,
      error: expect.stringContaining("Workers AI binding")
    });
  });

  it("rejects a delayed initial message after Stop completes", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const created = await post(
      "/api/bots",
      { brief: "Wait for my first message", conversation: true },
      session
    );
    const { teammate } = (await created.json()) as { teammate: { id: string } };

    expect((await post(`/api/bots/${teammate.id}/stop`, undefined, session)).status).toBe(200);

    const delayed = await post(
      `/api/bots/${teammate.id}/messages/initial`,
      { prompt: "hey" },
      session
    );
    expect(delayed.status).toBe(409);
    expect(await delayed.json()).toEqual({
      error: "This message was stopped before it started"
    });

    const teammateStorage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_TEAMMATE", { name: teammate.id });
    expect(
      await teammateStorage.exec("SELECT COUNT(*) AS count FROM cf_think_submissions")
    ).toEqual([{ count: 0 }]);
  });

  it("opens only the exact OAuth callback without an owner session", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const created = await post("/api/bots", { brief: "Connect tools." }, session);
    const { teammate } = (await created.json()) as { teammate: { id: string } };

    const callback = await request(
      `/agents/hqbot-teammate/${teammate.id}/callback?code=invalid&state=invalid`
    );
    expect(callback.status).not.toBe(401);

    const noncanonical = await request(
      `/agents/hqbot-teammate/${teammate.id}/extra/callback?code=invalid&state=invalid`
    );
    expect(noncanonical.status).toBe(401);

    const missing = await request(
      "/agents/hqbot-teammate/missing/callback?code=invalid&state=invalid"
    );
    expect(missing.status).toBe(404);
  });

  it("serves uploaded files only through their owning teammate", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const first = await post("/api/bots", { brief: "First teammate." }, session);
    const second = await post("/api/bots", { brief: "Second teammate." }, session);
    const firstBot = ((await first.json()) as { teammate: { id: string } }).teammate;
    const secondBot = ((await second.json()) as { teammate: { id: string } }).teammate;
    const boundary = "hqbot-artifact-boundary";
    const form = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="note.txt"',
      "Content-Type: text/plain",
      "",
      "private test file",
      `--${boundary}--`,
      ""
    ].join("\r\n");
    const uploaded = await request(`/api/bots/${firstBot.id}/files`, {
      body: form,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Cookie: session,
        Origin: origin
      },
      method: "POST"
    });
    const uploadedBody = (await uploaded.json()) as {
      file: { id: string; name: string };
    };

    expect(uploaded.status).toBe(201);
    expect(uploadedBody.file.name).toBe("note.txt");
    const owned = await request(`/api/bots/${firstBot.id}/files/${uploadedBody.file.id}`, {
      headers: { Cookie: session }
    });
    expect(owned.status).toBe(200);
    expect(await owned.text()).toBe("private test file");
    expect(owned.headers.get("Cache-Control")).toBe("private, no-store");
    expect(owned.headers.get("Content-Disposition")).toContain("attachment");

    const otherBot = await request(`/api/bots/${secondBot.id}/files/${uploadedBody.file.id}`, {
      headers: { Cookie: session }
    });
    expect(otherBot.status).toBe(404);
    expect(await otherBot.json()).toEqual({ error: "File not found" });

    const workspaceStorage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    const storedFiles = await workspaceStorage.exec(
      "SELECT object_key FROM files WHERE id = ?",
      uploadedBody.file.id
    );
    expect(storedFiles).toHaveLength(1);
    const objectKey = String(storedFiles[0]?.object_key);
    const rawKey = await request(`/api/artifacts/${encodeURIComponent(objectKey)}`, {
      headers: { Cookie: session }
    });
    expect(rawKey.status).toBe(400);
    expect(await rawKey.json()).toEqual({ error: "Invalid artifact path" });
  });

  it("stops all teammate activity and deletes its durable data", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const created = await post(
      "/api/bots",
      { brief: "Research this later", conversation: true },
      session
    );
    const { teammate } = (await created.json()) as { teammate: { id: string } };
    expect(
      (
        await post(
          `/api/bots/${teammate.id}/messages/initial`,
          { prompt: "Research this later" },
          session
        )
      ).status
    ).toBe(202);

    const teammateStorage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_TEAMMATE", { name: teammate.id });
    await teammateStorage.exec(
      "UPDATE cf_think_submissions SET status = 'pending', error_message = NULL, completed_at = NULL"
    );

    const stopped = await post(`/api/bots/${teammate.id}/stop`, undefined, session);
    const stoppedBody = await stopped.clone().json();
    expect(stopped.status, JSON.stringify(stoppedBody)).toBe(200);
    expect(await stopped.json()).toEqual({ stopped: true });
    expect(await teammateStorage.exec("SELECT status FROM cf_think_submissions")).toEqual([
      { status: "aborted" }
    ]);

    const boundary = "hqbot-test-boundary";
    const form = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="note.txt"',
      "Content-Type: text/plain",
      "",
      "test",
      `--${boundary}--`,
      ""
    ].join("\r\n");
    const uploaded = await request(`/api/bots/${teammate.id}/files`, {
      body: form,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Cookie: session,
        Origin: origin
      },
      method: "POST"
    });
    const uploadedBody = await uploaded.clone().json();
    expect(uploaded.status, JSON.stringify(uploadedBody)).toBe(201);
    const { file } = (await uploaded.json()) as { file: { id: string } };
    expect(
      (
        await request(`/api/bots/${teammate.id}/files/${file.id}`, {
          headers: { Cookie: session }
        })
      ).status
    ).toBe(200);

    const deleted = await request(`/api/bots/${teammate.id}`, {
      headers: { Cookie: session, Origin: origin },
      method: "DELETE"
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    expect(
      (
        await request(`/api/bots/${teammate.id}/files/${file.id}`, {
          headers: { Cookie: session }
        })
      ).status
    ).toBe(404);
    await expect
      .poll(
        async () =>
          (
            await request(`/agents/hqbot-teammate/${teammate.id}`, {
              headers: { Cookie: session }
            })
          ).status,
        { timeout: 5_000 }
      )
      .toBe(404);
    expect(
      await (await request("/api/snapshot", { headers: { Cookie: session } })).json()
    ).toMatchObject({ bots: [], selectedBot: null });

    const repeated = await request(`/api/bots/${teammate.id}`, {
      headers: { Cookie: session, Origin: origin },
      method: "DELETE"
    });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({ deleted: true });
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
    const blocked = [
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
      post(`/api/bots/${teammate.id}/desktop`, { requestId: "archived-open" }, session)
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
