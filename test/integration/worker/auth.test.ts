import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";

import { DEEPSEEK_FALLBACK_MODEL_ID } from "../../../src/domain/models";
import { schemaMigrations } from "../../../src/domain/schema";
import type { TeamPolicy } from "../../../src/domain/team-policy";
import type { TeamWork, TeamWorkRpc } from "../../../src/domain/team-work";

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
  it("serves inline owner actions across a Worker restart and rejects unauthorized decisions", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const snapshot = (await (
      await request("/api/snapshot", { headers: { Cookie: session } })
    ).json()) as { bots: { id: string }[] };
    const botId = snapshot.bots[0]?.id;
    const path = `/api/bots/${botId}/attention`;
    expect((await request(path)).status).toBe(401);
    const initial = (await (await request(path, { headers: { Cookie: session } })).json()) as {
      items: { botId: string; computerApprovals: unknown[]; handoff: unknown }[];
    };
    expect(initial.items).toHaveLength(1);
    expect(initial.items[0]).toMatchObject({ botId, computerApprovals: [], handoff: null });
    const storage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_TEAMMATE", { name: String(botId) });
    await storage.exec(
      "INSERT INTO hqbot_owner_handoffs (id, state, team_work_id, created_at) VALUES ('test-login', 'pending', NULL, '2026-09-06T12:00:00Z')"
    );
    await server.update((options) => ({
      ...options,
      workers: options.workers.map((worker) => ({
        ...worker,
        vars: { HQBOT_TEST_RESTART: "inline-handoff" }
      }))
    }));
    const restored = (await (await request(path, { headers: { Cookie: session } })).json()) as {
      items: { handoff: { id: string } }[];
    };
    expect(restored.items[0]?.handoff.id).toBe("test-login");
    expect((await request(path, { headers: { Cookie: session } })).status).toBe(200);
    expect(
      (await post(path, { botId: "unrelated", kind: "continue", id: "stale" }, session)).status
    ).toBe(409);
    expect(
      (
        await request(path, {
          method: "POST",
          headers: { Cookie: session, Origin: "https://evil.example" },
          body: JSON.stringify({ botId, kind: "continue", id: "stale" })
        })
      ).status
    ).toBe(403);
  });

  it("repairs an owner-result wait only after the handoff is closed", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const { teammate } = (await (
      await post("/api/bots", { brief: "Owner resume test", conversation: true }, session)
    ).json()) as { teammate: { id: string } };
    const path = `/api/bots/${teammate.id}`;
    await request(`${path}/attention`, { headers: { Cookie: session } });
    const storage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_TEAMMATE", { name: teammate.id });
    const stamp = new Date().toISOString();
    await storage.exec(
      "INSERT INTO hqbot_active_work (slot,task_id,goal,checkpoint,state,generation,wake_at,schedule_id,submission_id,last_error,created_at,updated_at) VALUES (1,'owner-resume','Resume test','Verify after sign-in','needs_user',2,NULL,NULL,NULL,NULL,?,?)",
      stamp,
      stamp
    );
    await storage.exec(
      "INSERT INTO hqbot_owner_handoffs (id,state,team_work_id,created_at) VALUES ('login','pending',NULL,?)",
      stamp
    );
    const env = (await server.getWorker().getEnv()) as {
      HQBOT_TEAMMATE: {
        getByName(id: string): {
          addMessages(messages: unknown[]): Promise<void>;
          recoverRuntime(): Promise<void>;
        };
      };
    };
    const peer = env.HQBOT_TEAMMATE.getByName(teammate.id);
    await peer.addMessages([
      {
        id: "computer-decision:test",
        role: "user",
        parts: [{ type: "text", text: "The owner approved the test action." }],
        metadata: {
          turnMetadata: { source: "computer-decision", taskId: "owner-resume", generation: 2 }
        }
      }
    ]);
    await peer.recoverRuntime();
    expect(await storage.exec("SELECT state FROM hqbot_active_work")).toEqual([
      { state: "needs_user" }
    ]);
    await storage.exec("UPDATE hqbot_owner_handoffs SET state = 'completed' WHERE id = 'login'");
    await peer.recoverRuntime();
    expect(await storage.exec("SELECT state FROM hqbot_active_work")).toEqual([
      { state: "scheduled" }
    ]);
    expect((await post(`${path}/stop`, {}, session)).status).toBe(200);
    await peer.recoverRuntime();
    expect(await storage.exec("SELECT state FROM hqbot_active_work")).toEqual([
      { state: "cancelled" }
    ]);
  });

  it("persists owner-controlled team settings and rejects unpriced or unauthenticated changes", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const snapshot = (await (
      await request("/api/snapshot", { headers: { Cookie: session } })
    ).json()) as { bots: { id: string; coordinationRole: string }[] };
    const chief = snapshot.bots.find((bot) => bot.coordinationRole === "chief");
    const path = `/api/bots/${chief?.id}/team-management`;
    const initial = (await (await request(path, { headers: { Cookie: session } })).json()) as {
      policy: TeamPolicy;
    };
    expect(initial.policy).toMatchObject({ canManage: true, canCreate: false });
    const policy = {
      ...initial.policy,
      canCreate: true,
      maxEmployees: 3,
      allowedModelIds: [initial.policy.defaultModelId, DEEPSEEK_FALLBACK_MODEL_ID]
    };
    const patch = (body: unknown, authenticated = true) =>
      request(path, {
        method: "PATCH",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(authenticated ? { Cookie: session } : {})
        },
        body: JSON.stringify(body)
      });
    expect((await patch(policy, false)).status).toBe(401);
    expect(
      (
        await patch({
          ...policy,
          allowedModelIds: ["openai/gpt-5.4"],
          defaultModelId: "openai/gpt-5.4"
        })
      ).status
    ).toBe(400);
    expect((await patch(policy)).status).toBe(200);
    expect(
      (
        (await (await request(path, { headers: { Cookie: session } })).json()) as {
          policy: TeamPolicy;
        }
      ).policy
    ).toEqual(policy);
    const bindings = (await server.getWorker().getEnv()) as {
      HQBOT_AGENT: { getByName(name: string): TeamWorkRpc };
    };
    const agent = bindings.HQBOT_AGENT.getByName("hqbot");
    const hire = {
      action: "hire" as const,
      key: "hire-test",
      name: "Evidence",
      role: "Check public sources",
      modelId: DEEPSEEK_FALLBACK_MODEL_ID
    };
    const employee = (await agent.coordinate(chief?.id ?? "", hire, undefined, "hire")) as {
      id: string;
      modelId: string;
    };
    expect(employee.modelId).toBe(DEEPSEEK_FALLBACK_MODEL_ID);
    expect(
      ((await agent.coordinate(chief?.id ?? "", hire, undefined, "retry")) as { id: string }).id
    ).toBe(employee.id);
    expect(await agent.getTeamPolicy(employee.id)).toMatchObject({
      canManage: false,
      canCreate: false
    });
    await expect(
      agent.coordinate(
        chief?.id ?? "",
        { ...hire, key: "member-hire" },
        undefined,
        "member",
        "member"
      )
    ).rejects.toBeDefined();
  });
  it("keeps specialist questions across restart and rejects replies from another assignment", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const snapshot = (await (
      await request("/api/snapshot", { headers: { Cookie: session } })
    ).json()) as { bots: { id: string; coordinationRole: string }[] };
    const chief = snapshot.bots.find((bot) => bot.coordinationRole === "chief")?.id ?? "missing";
    const employees: string[] = [];
    for (const brief of ["Question writer", "Question researcher", "Question outsider"]) {
      const result = (await (
        await post("/api/bots", { brief, conversation: true }, session)
      ).json()) as { teammate: { id: string } };
      employees.push(result.teammate.id);
    }
    const agent = async () =>
      (
        (await server.getWorker().getEnv()) as {
          HQBOT_AGENT: { getByName(name: string): TeamWorkRpc };
        }
      ).HQBOT_AGENT.getByName("hqbot");
    const initial = await agent();
    const work = (await initial.coordinate(
      chief,
      {
        action: "start",
        goal: "Check peer question recovery",
        criteria: ["Saved reply"],
        budgetUsd: 0.1
      },
      undefined,
      "peer-start"
    )) as TeamWork;
    const workId = String(work.id);
    for (const botId of employees.slice(0, 2))
      await initial.coordinate(
        chief,
        {
          action: "assign",
          key: botId,
          botId,
          instruction: `Check ${botId}`,
          criterion: "Evidence"
        },
        workId,
        botId
      );
    const input = {
      action: "ask" as const,
      key: "source",
      botId: employees[1],
      question: "Which saved source supports this?"
    };
    const result = (await initial.coordinate(employees[0], input, workId, "question")) as {
      questionId: string;
    };
    const questionId = String(result.questionId);
    await initial.coordinate(employees[0], input, workId, "retry");
    await expect(
      initial.coordinate(
        employees[2],
        { action: "answer", questionId: questionId, answer: "Fake" },
        workId,
        "spoof"
      )
    ).rejects.toBeDefined();
    await server.update((options) => ({
      ...options,
      workers: options.workers.map((worker) => ({
        ...worker,
        vars: { HQBOT_TEST_RESTART: "peer-questions" }
      }))
    }));
    const resumed = await agent();
    expect((await resumed.teamBriefing(employees[1], workId))?.instructions).toContain(questionId);
    await resumed.coordinate(
      employees[1],
      {
        action: "answer",
        questionId: questionId,
        answer: "The saved official source supports it."
      },
      workId,
      "answer"
    );
    const saved = await resumed.teamWorkForBot(chief, workId);
    expect(saved?.updates?.filter((item) => item.kind === "question")).toHaveLength(1);
    expect(saved?.updates?.find((item) => item.kind === "answer")?.message).toContain(
      "saved official source"
    );
    expect((await post(`/api/bots/${chief}/stop`, {}, session)).status).toBe(200);
    await expect(
      resumed.coordinate(employees[0], { ...input, key: "late" }, workId, "late")
    ).rejects.toBeDefined();
  });
  it("keeps one Chief and cancels a saved team task across a Worker restart", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const snapshot = async () =>
      (await (await request("/api/snapshot", { headers: { Cookie: session } })).json()) as {
        bots: { id: string; coordinationRole: string }[];
        selectedBot: { id: string };
      };
    const first = await snapshot();
    const chief = first.bots.find((bot) => bot.coordinationRole === "chief");
    expect(chief).toBeDefined();
    expect(first.selectedBot.id).toBe(chief?.id);
    expect((await snapshot()).bots.filter((bot) => bot.coordinationRole === "chief")).toHaveLength(
      1
    );
    const { teammate } = (await (
      await post("/api/bots", { brief: "Team queue test", conversation: true }, session)
    ).json()) as { teammate: { id: string } };
    const bindings = (await server.getWorker().getEnv()) as {
      HQBOT_AGENT: { getByName(name: string): TeamWorkRpc };
    };
    const agent = bindings.HQBOT_AGENT.getByName("hqbot");
    const work = (await agent.coordinate(
      chief?.id ?? "",
      {
        action: "start",
        goal: "Check the team cancellation path",
        criteria: ["All specialist work stops"],
        budgetUsd: 0.1
      },
      undefined,
      "integration-start"
    )) as TeamWork;
    const ownerBotId = String(work.ownerBotId);
    const assignment = {
      action: "assign" as const,
      key: "specialist",
      botId: teammate.id,
      instruction: "Wait for the cancellation test",
      criterion: "No work after cancellation"
    };
    await agent.coordinate(work.ownerBotId, assignment, work.id, "assign");
    await agent.coordinate(work.ownerBotId, assignment, work.id, "assign");
    expect((await agent.teamWorkForBot(work.ownerBotId, work.id))?.assignments).toHaveLength(1);
    await expect(
      agent.coordinate(teammate.id, { ...assignment, botId: work.ownerBotId }, work.id, "recursive")
    ).rejects.toBeDefined();
    expect((await agent.teamWorkForBot(work.ownerBotId, work.id))?.assignments).toHaveLength(1);
    expect((await post(`/api/bots/${work.ownerBotId}/stop`, {}, session)).status).toBe(200);
    await server.update((options) => ({
      ...options,
      workers: options.workers.map((worker) => ({
        ...worker,
        vars: { HQBOT_TEST_RESTART: "team-stopped" }
      }))
    }));
    const response = await request(`/api/bots/${ownerBotId}/team-work`, {
      headers: { Cookie: session }
    });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as { work: TeamWork };
    expect(saved.work.state).toBe("cancelled");
    expect(saved.work.assignments[0]?.state).toBe("cancelled");
    const storage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    expect(
      await storage.exec("SELECT id FROM team_turns WHERE state IN ('pending','submitted')")
    ).toEqual([]);
    expect((await snapshot()).bots.filter((bot) => bot.coordinationRole === "chief")).toHaveLength(
      1
    );
  });

  it("keeps cancelled task state and activity times through a Worker restart", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const { teammate } = (await (
      await post("/api/bots", { brief: "Endurance recovery", conversation: true }, session)
    ).json()) as { teammate: { id: string } };
    await request(`/api/bots/${teammate.id}/task-progress`, { headers: { Cookie: session } });
    const worker = server.getWorker();
    const peerStorage = await worker.getDurableObjectStorage("HQBOT_TEAMMATE", {
      name: teammate.id
    });
    const stamp = new Date().toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await peerStorage.exec(
      `INSERT INTO hqbot_active_work (slot,task_id,goal,checkpoint,state,generation,wake_at,schedule_id,submission_id,last_error,created_at,updated_at)
       VALUES (1,'endurance','Endurance test','Milestone 6','waiting',12,?,NULL,NULL,NULL,?,?)`,
      future,
      stamp,
      stamp
    );
    const bindings = async () =>
      (await worker.getEnv()) as {
        HQBOT_TEAMMATE: { getByName(name: string): { recoverRuntime(): Promise<void> } };
      };
    await (await bindings()).HQBOT_TEAMMATE.getByName(teammate.id).recoverRuntime();
    expect((await post(`/api/bots/${teammate.id}/stop`, {}, session)).status).toBe(200);
    const snapshot = async () =>
      (await (
        await request(`/api/snapshot?botId=${teammate.id}`, { headers: { Cookie: session } })
      ).json()) as {
        selectedBot: { status: string; lastInteractedAt: string };
        activeTask: { status: string; error: string };
      };
    const stopped = await snapshot();
    expect(stopped.selectedBot.status).toBe("idle");
    expect(stopped.activeTask).toMatchObject({
      status: "cancelled",
      error: "The owner stopped this teammate"
    });
    await server.update((options) => ({
      ...options,
      workers: options.workers.map((worker) => ({
        ...worker,
        vars: { HQBOT_TEST_RESTART: "after-stop" }
      }))
    }));
    await (await bindings()).HQBOT_TEAMMATE.getByName(teammate.id).recoverRuntime();
    await (await bindings()).HQBOT_TEAMMATE.getByName(teammate.id).recoverRuntime();
    const after = await snapshot();
    expect(after.selectedBot).toEqual(stopped.selectedBot);
    expect(after.activeTask).toEqual(stopped.activeTask);
    const workspaceStorage = await worker.getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    expect(
      await workspaceStorage.exec(
        "SELECT actor_id, action, target_id FROM access_audit WHERE action='work.stop'"
      )
    ).toEqual([{ actor_id: "owner", action: "work.stop", target_id: teammate.id }]);
  });

  it("pairs a scoped local client, starts once, and rejects revoked device tokens", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const { teammate } = (await (
      await post("/api/bots", { brief: "Local files" }, session)
    ).json()) as { teammate: { id: string } };
    expect((await post("/api/local-devices/pair", { botIds: [teammate.id] })).status).toBe(401);
    const { code } = (await (
      await post("/api/local-devices/pair", { botIds: [teammate.id] }, session)
    ).json()) as { code: string };
    const paired = await post("/api/local-client/pair", { code, name: "Test Mac" });
    expect(paired.status).toBe(201);
    const device = (await paired.json()) as { id: string; token: string };
    expect((await post("/api/local-client/pair", { code, name: "Duplicate" })).status).toBe(409);
    const storage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    const stamp = new Date().toISOString();
    await storage.exec(
      "INSERT INTO local_jobs (id,device_id,bot_id,command,directory,state,created_at,updated_at) VALUES (?,?,?,'pwd','','queued',?,?)",
      "command",
      device.id,
      teammate.id,
      stamp,
      stamp
    );
    const client = (path: string, body?: unknown) =>
      request(`/api/local-client${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${device.token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
    expect(await (await client("/jobs")).json()).toMatchObject({ jobs: [{ id: "command" }] });
    const claim = { id: "command", claimId: crypto.randomUUID() };
    expect((await client("/claim", claim)).status).toBe(200);
    expect((await client("/start", claim)).status).toBe(200);
    expect((await client("/start", claim)).status).toBe(409);
    expect(
      (
        await request(`/api/local-devices/${device.id}`, {
          method: "DELETE",
          headers: { Cookie: session, Origin: origin }
        })
      ).status
    ).toBe(200);
    expect((await client("/result", { ...claim, state: "completed", result: "late" })).status).toBe(
      401
    );
    expect((await client("/jobs")).status).toBe(401);
  });

  it("enforces named team access on HTTP, files, agent routes, and revocation", async () => {
    const ownerSession = cookie(await post("/api/auth/bootstrap", owner));
    const createBot = async (brief: string) =>
      (
        (await (await post("/api/bots", { brief }, ownerSession)).json()) as {
          teammate: { id: string };
        }
      ).teammate;
    const shared = await createBot("Shared research");
    const privateBot = await createBot("Private work");
    const { project } = (await (
      await post("/api/projects", { name: "Shared project", botIds: [shared.id] }, ownerSession)
    ).json()) as { project: { id: string } };
    const invite = await post(
      "/api/team/invitations",
      { role: "member", projectIds: [project.id] },
      ownerSession
    );
    expect(invite.status).toBe(201);
    const { token } = (await invite.json()) as { token: string };
    const accepted = await post("/api/auth/accept-invitation", {
      invitation: token,
      username: "alex",
      password: "member correct horse battery"
    });
    expect(accepted.status).toBe(201);
    const memberSession = cookie(accepted);
    const { user } = (await accepted.json()) as { user: { id: string } };
    expect(
      await (await request("/api/team/workspace", { headers: { Cookie: memberSession } })).json()
    ).toMatchObject({
      user: { role: "member" },
      bots: [{ id: shared.id }],
      projects: [{ id: project.id }]
    });
    const get = (path: string) => request(path, { headers: { Cookie: memberSession } });
    expect((await get("/api/snapshot")).status).toBe(403);
    expect((await get(`/api/team/bots/${privateBot.id}`)).status).toBe(403);
    expect((await get(`/api/bots/${privateBot.id}/files/fake`)).status).toBe(403);
    expect((await get(`/agents/hqbot-teammate/${shared.id}`)).status).toBe(401);
    expect((await get("/agents/hqbot-agent/hqbot")).status).toBe(401);
    expect((await get(`/api/team/bots/${shared.id}`)).status).toBe(200);
    expect(
      (await post("/api/team/invitations", { role: "admin", projectIds: [] }, memberSession)).status
    ).toBe(400);
    expect(
      (await post("/api/templates/publish", { id: crypto.randomUUID() }, memberSession)).status
    ).toBe(403);
    const changed = await request(`/api/team/members/${user.id}`, {
      method: "PATCH",
      headers: { Cookie: ownerSession, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "viewer", disabled: false, projectIds: [project.id] })
    });
    expect(changed.status).toBe(200);
    expect((await get(`/api/team/bots/${shared.id}`)).status).toBe(401);
    const viewerSession = cookie(
      await post("/api/auth/login", { username: "alex", password: "member correct horse battery" })
    );
    expect(
      (
        await post(
          `/api/team/bots/${shared.id}/messages`,
          { id: crypto.randomUUID(), prompt: "Do work" },
          viewerSession
        )
      ).status
    ).toBe(403);
    expect(
      (await request(`/api/team/bots/${shared.id}`, { headers: { Cookie: viewerSession } })).status
    ).toBe(200);
    const policy = await post(
      "/api/team/policy",
      { mode: "connectors-only", origins: ["https://docs.mcp.cloudflare.com"] },
      ownerSession
    );
    expect(policy.status).toBe(200);
    expect(
      (await post("/api/team/policy", { mode: "standard", origins: [] }, viewerSession)).status
    ).toBe(403);
  });

  it("imports safe templates and revokes the public link without exposing private fields", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const { teammate } = (await (
      await post("/api/bots", { brief: "Research" }, session)
    ).json()) as { teammate: { id: string } };
    const { template } = (await (
      await post(
        "/api/templates/export",
        { botId: teammate.id, skillIds: [], routineIds: [] },
        session
      )
    ).json()) as { template: { profile: { name: string } } };
    template.profile.name = "<script>private</script>";
    const id = crypto.randomUUID();
    expect((await post("/api/templates/publish", { id, template })).status).toBe(401);
    expect((await post("/api/templates/publish", { id, template }, session)).status).toBe(201);
    const page = await request(`/api/public/templates/${id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(page.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const download = await request(`/api/public/templates/${id}?download=1`);
    expect(await download.json()).toEqual(template);
    const importId = crypto.randomUUID();
    const imported = await post("/api/templates/import", { id: importId, template }, session);
    expect(imported.status).toBe(201);
    expect(
      await (await post("/api/templates/import", { id: importId, template }, session)).json()
    ).toEqual(await imported.json());
    expect(
      (
        await request(`/api/templates/shares/${id}`, {
          method: "DELETE",
          headers: { Cookie: session, Origin: origin }
        })
      ).status
    ).toBe(200);
    expect((await request(`/api/public/templates/${id}`)).status).toBe(404);
  });

  it("searches saved work and validates discussion sources before accepting notes", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const { teammate } = (await (
      await post("/api/bots", { brief: "Search work" }, session)
    ).json()) as { teammate: { id: string } };
    const { project } = (await (
      await post("/api/projects", { name: "Search project", botIds: [teammate.id] }, session)
    ).json()) as { project: { id: string } };
    const storage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    await storage.exec(
      "INSERT INTO project_messages (id,project_id,content,created_at) VALUES (?,?,?,?)",
      "message",
      project.id,
      "Verified invoice total",
      new Date().toISOString()
    );
    const source = { kind: "project", id: project.id, messageId: "message" };
    expect(
      (
        await post("/api/discussions", {
          ...source,
          noteId: crypto.randomUUID(),
          content: "Reviewed"
        })
      ).status
    ).toBe(401);
    expect(
      (
        await post(
          "/api/discussions",
          { ...source, messageId: "missing", noteId: crypto.randomUUID(), content: "Reviewed" },
          session
        )
      ).status
    ).toBe(404);
    const note = { ...source, noteId: crypto.randomUUID(), content: "Reviewed" };
    expect((await post("/api/discussions", note, session)).status).toBe(200);
    expect((await post("/api/discussions", note, session)).status).toBe(200);
    const read = await request(`/api/discussions?${new URLSearchParams(source)}`, {
      headers: { Cookie: session }
    });
    expect(await read.json()).toMatchObject({
      content: "Verified invoice total",
      notes: [{ content: "Reviewed" }]
    });
    const results = await request("/api/search?q=invoice", { headers: { Cookie: session } });
    expect(await results.json()).toMatchObject({
      hits: [{ kind: "project", text: "Verified invoice total" }]
    });
  });

  it("queues an uploaded demonstration once and cancels it through Stop", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const { teammate } = (await (
      await post("/api/bots", { brief: "Recorded method", conversation: true }, session)
    ).json()) as { teammate: { id: string } };
    const upload = async (name: string, type: string) => {
      const boundary = "hqbot-demo-boundary";
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\nrecorded-test-bytes\r\n--${boundary}--\r\n`;
      const response = await request(`/api/bots/${teammate.id}/files`, {
        method: "POST",
        headers: {
          Cookie: session,
          Origin: origin,
          "Content-Type": `multipart/form-data; boundary=${boundary}`
        },
        body
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { file: { id: string } }).file.id;
    };
    const videoId = await upload("demo.webm", "video/webm");
    const frameId = await upload("step.jpg", "image/jpeg");
    const input = {
      id: crypto.randomUUID(),
      name: "Method",
      notes: "Read the visible total",
      videoId,
      frames: [{ fileId: frameId, seconds: 1 }]
    };
    const path = `/api/bots/${teammate.id}/demonstrations`;
    expect((await post(path, input)).status).toBe(401);
    expect((await post(path, input, session)).status).toBe(202);
    expect((await post(path, input, session)).status).toBe(202);
    expect((await post(`/api/bots/${teammate.id}/stop`, undefined, session)).status).toBe(200);
    const result = (await (await request(path, { headers: { Cookie: session } })).json()) as {
      demonstrations: { state: string; skillId: string | null }[];
    };
    expect(result.demonstrations).toHaveLength(1);
    expect(result.demonstrations[0]).toMatchObject({ state: "cancelled", skillId: null });
  });
  it("keeps the installation push key private and manages named devices through owner routes", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    expect((await post("/api/push/configure")).status).toBe(401);
    const configured = await post("/api/push/configure", undefined, session);
    expect(configured.status).toBe(200);
    const config = (await configured.json()) as { publicKey: string };
    expect(Object.keys(config)).toEqual(["publicKey"]);
    expect(config.publicKey).toHaveLength(87);
    expect(await (await post("/api/push/configure", undefined, session)).json()).toEqual(config);
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits"
    ]);
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/worker-test",
      expirationTime: null,
      keys: {
        p256dh: Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString(
          "base64url"
        ),
        auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url")
      }
    };
    const created = await post(
      "/api/push/devices",
      {
        name: "Test browser",
        preferences: { replies: true, failures: true, input: true },
        subscription
      },
      session
    );
    expect(created.status).toBe(200);
    const { device } = (await created.json()) as { device: { id: string } };
    const list = await (
      await request("/api/push/devices", { headers: { Cookie: session } })
    ).text();
    expect(list).toContain("Test browser");
    expect(list).not.toContain(subscription.endpoint);
    expect(list).not.toContain(subscription.keys.auth);
    const storage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    expect(
      await storage.exec(
        "SELECT COUNT(*) AS count FROM cf_agents_schedules WHERE callback = 'deliverDevicePush' AND type = 'interval'"
      )
    ).toEqual([{ count: 1 }]);
    expect(
      (
        await request(`/api/push/devices/${device.id}`, {
          method: "DELETE",
          headers: { Cookie: session, Origin: origin }
        })
      ).status
    ).toBe(200);
    expect(await storage.exec("SELECT COUNT(*) AS count FROM push_devices")).toEqual([
      { count: 0 }
    ]);
    expect(
      await storage.exec(
        "SELECT COUNT(*) AS count FROM cf_agents_schedules WHERE callback = 'deliverDevicePush'"
      )
    ).toEqual([{ count: 0 }]);
  });
  it("accepts signed public event deliveries once and keeps trigger secrets private", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const { teammate } = (await (
      await post("/api/bots", { brief: "Events test", conversation: true }, session)
    ).json()) as { teammate: { id: string } };
    const { routine } = (await (
      await post(
        "/api/automations",
        {
          botId: teammate.id,
          name: "Tickets",
          prompt: "Read this event",
          schedule: { kind: "event" }
        },
        session
      )
    ).json()) as { routine: { id: string } };
    const id = crypto.randomUUID();
    const settings = {
      id,
      routineId: routine.id,
      botId: teammate.id,
      name: "Tickets",
      filter: { provider: "generic", eventType: "ticket.created" }
    };
    expect((await post("/api/event-triggers", settings)).status).toBe(401);
    const created = await post("/api/event-triggers", settings, session);
    expect(created.status).toBe(200);
    const { secret, trigger } = (await created.json()) as {
      secret: string;
      trigger: { revision: number };
    };
    const listing = await request(`/api/event-triggers?routineId=${routine.id}`, {
      headers: { Cookie: session }
    });
    expect(await listing.text()).not.toContain(secret);
    const body = JSON.stringify({ type: "ticket.created", ticket: { id: "ticket-1" } });
    const stamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret)
      .update(`v1:${stamp}:delivery-1:${body}`)
      .digest("hex");
    const headers = {
      "Content-Type": "application/json",
      "X-HQBot-Timestamp": stamp,
      "X-HQBot-Delivery": "delivery-1",
      "X-HQBot-Signature": `sha256=${signature}`
    };
    expect((await request(`/events/${id}`, { method: "POST", body })).status).toBe(401);
    expect(
      await (await request(`/events/${id}`, { method: "POST", headers, body })).json()
    ).toMatchObject({ state: "accepted" });
    expect(
      await (await request(`/events/${id}`, { method: "POST", headers, body })).json()
    ).toEqual({ state: "duplicate" });
    const storage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    expect(
      await storage.exec("SELECT COUNT(*) AS count FROM routine_runs WHERE source = 'event'")
    ).toEqual([{ count: 1 }]);
    expect(await storage.exec("SELECT COUNT(*) AS count FROM event_receipts")).toEqual([
      { count: 1 }
    ]);
    expect(
      (
        await post(
          "/api/event-triggers",
          { ...settings, revision: trigger.revision, enabled: false },
          session
        )
      ).status
    ).toBe(200);
    expect((await request(`/events/${id}`, { method: "POST", headers, body })).status).toBe(404);
  });
  it("verifies Slack endpoint challenges and deduplicates GitHub bytes with changed delivery headers", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const { teammate } = (await (
      await post("/api/bots", { brief: "Provider test", conversation: true }, session)
    ).json()) as { teammate: { id: string } };
    const { routine } = (await (
      await post(
        "/api/automations",
        {
          botId: teammate.id,
          name: "Events",
          prompt: "Read this event",
          schedule: { kind: "event" }
        },
        session
      )
    ).json()) as { routine: { id: string } };
    const secret = "public-integration-test-secret-32";
    const slackId = crypto.randomUUID();
    expect(
      (
        await post(
          "/api/event-triggers",
          {
            id: slackId,
            botId: teammate.id,
            routineId: routine.id,
            name: "Slack",
            secret,
            filter: { provider: "slack", teamId: "T123", channelId: "C123" }
          },
          session
        )
      ).status
    ).toBe(200);
    const body = JSON.stringify({ type: "url_verification", challenge: "signed-challenge" });
    const stamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`v0:${stamp}:${body}`).digest("hex");
    expect(
      await (
        await request(`/events/${slackId}`, {
          method: "POST",
          body,
          headers: { "X-Slack-Request-Timestamp": stamp, "X-Slack-Signature": `v0=${signature}` }
        })
      ).json()
    ).toEqual({ challenge: "signed-challenge" });
    const githubId = crypto.randomUUID();
    expect(
      (
        await post(
          "/api/event-triggers",
          {
            id: githubId,
            botId: teammate.id,
            routineId: routine.id,
            name: "GitHub",
            secret,
            filter: { provider: "github", repository: "test/repo", action: "opened" }
          },
          session
        )
      ).status
    ).toBe(200);
    const githubBody = JSON.stringify({ repository: { full_name: "test/repo" }, action: "opened" });
    const githubSignature = createHmac("sha256", secret).update(githubBody).digest("hex");
    const send = (id: string) =>
      request(`/events/${githubId}`, {
        method: "POST",
        body: githubBody,
        headers: { "X-Hub-Signature-256": `sha256=${githubSignature}`, "X-GitHub-Delivery": id }
      });
    expect(await (await send("original")).json()).toMatchObject({ state: "accepted" });
    expect(await (await send("forged-replay")).json()).toMatchObject({ state: "duplicate" });
  });
  it("schedules local calendar times and updates the native schedule after editing", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const { teammate } = (await (
      await post("/api/bots", { brief: "Calendar test", conversation: true }, session)
    ).json()) as { teammate: { id: string } };
    const saved = await post(
      "/api/automations",
      {
        botId: teammate.id,
        name: "Morning brief",
        prompt: "Check official sources",
        schedule: {
          kind: "calendar",
          days: [1, 2, 3, 4, 5],
          time: "09:00",
          timezone: "America/Toronto"
        }
      },
      session
    );
    expect(saved.status).toBe(200);
    const { routine } = (await saved.json()) as { routine: { id: string; revision: number } };
    const read = async () =>
      (await (
        await request(`/api/bots/${teammate.id}/routines/${routine.id}/runs`, {
          headers: { Cookie: session }
        })
      ).json()) as { runs: unknown[]; nextRunAt: string };
    const first = await read();
    expect(first.nextRunAt).toBeTypeOf("string");
    expect(first.runs).toEqual([]);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Toronto",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short"
    }).formatToParts(new Date(first.nextRunAt));
    expect(parts.find((part) => part.type === "hour")?.value).toBe("09");
    expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(
      parts.find((part) => part.type === "weekday")?.value
    );
    const edited = await post(
      "/api/automations",
      {
        id: routine.id,
        revision: routine.revision,
        botId: teammate.id,
        name: "Morning brief",
        prompt: "Check official sources",
        schedule: {
          kind: "calendar",
          days: [1, 2, 3, 4, 5],
          time: "10:30",
          timezone: "America/Toronto"
        }
      },
      session
    );
    expect(edited.status).toBe(200);
    const next = (await read()).nextRunAt;
    expect(next).not.toBe(first.nextRunAt);
    expect(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Toronto",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date(next))
    ).toBe("10:30");
  });
  it("serves persistent knowledge, scoped permissions, and projects through authenticated routes", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const created = await post(
      "/api/bots",
      { brief: "Product route test", conversation: true },
      session
    );
    const { teammate } = (await created.json()) as { teammate: { id: string } };
    const knowledge = `/api/bots/${teammate.id}/knowledge`;
    expect((await request(knowledge)).status).toBe(401);
    const saved = await post(
      knowledge,
      {
        commandId: "remember",
        entry: { kind: "memory", content: "Use source links", source: "Owner preference" }
      },
      session
    );
    expect(saved.status).toBe(200);
    const { item } = (await saved.json()) as { item: { id: string; revision: number } };
    expect(item.revision).toBe(1);
    expect(
      (
        await post(
          knowledge,
          {
            commandId: "revise",
            entry: {
              kind: "memory",
              id: item.id,
              revision: 1,
              content: "Use source links and short reports",
              source: "Owner correction"
            }
          },
          session
        )
      ).status
    ).toBe(200);
    const history = await request(`${knowledge}?history=${item.id}`, {
      headers: { Cookie: session }
    });
    expect(await history.json()).toMatchObject({ versions: [{ revision: 2 }, { revision: 1 }] });
    const rules = `/api/bots/${teammate.id}/permission-rules`;
    expect(
      (
        await post(
          rules,
          {
            label: "Help center",
            connector: "computer",
            action: "browser_open",
            decision: "allow",
            scope: { kind: "origin", field: "url", origin: "https://example.com" }
          },
          session
        )
      ).status
    ).toBe(200);
    const permissions = await request(rules, { headers: { Cookie: session } });
    expect(await permissions.json()).toMatchObject({
      rules: [{ label: "Help center", decision: "allow" }],
      connections: [{ connector: "computer" }]
    });
    const project = await post(
      "/api/projects",
      { name: "Website", botIds: [teammate.id] },
      session
    );
    expect(project.status).toBe(200);
    const projects = await request("/api/projects", { headers: { Cookie: session } });
    expect(await projects.json()).toMatchObject({
      projects: [{ name: "Website", botIds: [teammate.id], resources: [] }]
    });
    expect(
      (await post("/api/projects", { name: "Unknown member", botIds: ["unknown"] }, session)).status
    ).toBe(400);
  });
  it("lists backups when the optional version path is absent", async () => {
    const session = cookie(await post("/api/auth/bootstrap", owner));
    const created = await post(
      "/api/bots",
      { brief: "Backup route test", conversation: true },
      session
    );
    const { teammate } = (await created.json()) as { teammate: { id: string } };
    const response = await request(`/api/bots/${teammate.id}/backups`, {
      headers: { Cookie: session }
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ backups: [], status: { running: false } });
  });
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
      bots: [{ coordinationRole: "chief", pinned: true }],
      realtime: { url: "/agents/hqbot-agent/hqbot" }
    });

    const repeat = await post("/api/auth/bootstrap", owner);
    expect(repeat.status).toBe(409);
    expect(await repeat.json()).toEqual({ error: "HQBot already has an owner" });

    expect((await post("/api/auth/logout", undefined, bootstrapSession)).status).toBe(200);
    const login = await post("/api/auth/login", owner);
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({
      authenticated: true,
      user: { id: "owner", username: "owner", role: "owner" }
    });
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
    expect(await storage.exec("SELECT version FROM schema_migrations ORDER BY version")).toEqual(
      schemaMigrations.map(({ version }) => ({ version }))
    );
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
    const manualRunBody = (await manualRun.json()) as { run: { id: string; state: string } };
    expect(manualRun.status, JSON.stringify(manualRunBody)).toBe(202);
    expect(manualRunBody).toMatchObject({ run: { id: expect.any(String), state: "queued" } });

    const workspaceStorage = await server
      .getWorker()
      .getDurableObjectStorage("HQBOT_AGENT", { name: "hqbot" });
    expect(await workspaceStorage.exec("SELECT COUNT(*) AS count FROM tasks")).toEqual([
      { count: 0 }
    ]);

    const runs = await workspaceStorage.exec(
      "SELECT id, prompt FROM routine_runs WHERE id = ?",
      manualRunBody.run.id
    );
    expect(runs).toHaveLength(1);
    expect(String(runs[0]?.prompt)).toContain("Check for updates");
    const history = await request(
      `/api/bots/${teammate.id}/routines/${acceptedBody.routine.id}/runs`,
      { headers: { Cookie: session } }
    );
    expect(await history.json()).toMatchObject({
      runs: [{ id: manualRunBody.run.id, source: "manual" }]
    });

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
    ).toMatchObject({
      bots: [{ coordinationRole: "chief" }],
      selectedBot: { coordinationRole: "chief" }
    });

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
