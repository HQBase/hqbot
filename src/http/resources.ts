import {
  cleanString,
  json,
  pathMatch,
  readJson,
  requireActiveTeammate,
  teammate,
  workspace
} from "./common";

function nextRun(intervalMinutes: number): string {
  return new Date(Date.now() + intervalMinutes * 60_000).toISOString();
}

export async function handleResources(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const agent = await workspace(env);

  const notification = pathMatch(url.pathname, /^\/api\/notifications\/([^/]+)\/read$/u);
  if (request.method === "POST" && notification?.[0]) {
    await agent.readNotification(notification[0]);
    return json({ saved: true });
  }
  const teamProgress = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/team-work$/u);
  if (request.method === "GET" && teamProgress?.[0]) {
    const work = await agent.teamWorkForBot(teamProgress[0]);
    const names = Object.fromEntries((await agent.listBots()).map((bot) => [bot.id, bot.name]));
    return json({ work, names });
  }
  const health = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/task-health$/u);
  if (request.method === "GET" && health?.[0])
    return json(await (await teammate(env, health[0])).getTaskHealth());
  const progress = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/task-progress$/u);
  if (request.method === "GET" && progress?.[0])
    return json(await (await teammate(env, progress[0])).getTaskProgress());

  const permissions = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/computer-permissions$/u);
  if (permissions?.[0]) {
    const unavailable = await requireActiveTeammate(agent, permissions[0]);
    if (unavailable) return unavailable;
    const peer = await teammate(env, permissions[0]);
    if (request.method === "GET")
      return json({
        policy: await peer.getComputerPolicy(),
        approvals: await peer.listComputerApprovals()
      });
    if (request.method === "POST") {
      const body = await readJson(request);
      if (body.policy === "autonomous" || body.policy === "review" || body.policy === "allow")
        await peer.setComputerPolicy(body.policy);
      else if (typeof body.approved === "boolean")
        await peer.resolveComputerApproval(
          cleanString(body, "executionId", 300),
          cleanString(body, "inputHash", 100),
          body.approved
        );
      else return json({ error: "A permission or decision is required" }, 400);
      return json({ saved: true });
    }
  }

  const actions = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/actions$/u);
  if (request.method === "GET" && actions?.[0])
    return json({ actions: await (await teammate(env, actions[0])).listActionHistory() });
  const resolveAction = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/actions\/resolve$/u);
  if (request.method === "POST" && resolveAction?.[0]) {
    const unavailable = await requireActiveTeammate(agent, resolveAction[0]);
    if (unavailable) return unavailable;
    const body = await readJson(request);
    if (typeof body.happened !== "boolean")
      return json({ error: "A checked outcome is required" }, 400);
    await (await teammate(env, resolveAction[0])).resolveUnknownAction(
      cleanString(body, "id", 300),
      cleanString(body, "evidence", 20_000),
      body.happened
    );
    return json({ saved: true });
  }

  const memories = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/memories$/u);
  if (request.method === "GET" && memories?.[0]) {
    const items = await agent.listMemories(memories[0], {
      query: url.searchParams.get("query") ?? "",
      before: url.searchParams.get("before") ?? ""
    });
    const last = items.at(-1);
    return json({
      memories: items,
      nextCursor: items.length === 50 && last ? `${last.createdAt}:${last.id}` : null
    });
  }
  if (request.method === "POST" && memories?.[0]) {
    const unavailable = await requireActiveTeammate(agent, memories[0]);
    if (unavailable) return unavailable;
    const body = await readJson(request);
    const memory = await agent.createMemory(
      crypto.randomUUID(),
      memories[0],
      cleanString(body, "content", 500)
    );
    return json({ memory }, 201);
  }

  const memory = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/memories\/([^/]+)$/u);
  if (request.method === "DELETE" && memory?.[0] && memory[1]) {
    return (await agent.deleteMemory(memory[1], memory[0]))
      ? json({ deleted: true })
      : json({ error: "Memory not found" }, 404);
  }

  const skills = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/skills$/u);
  if (request.method === "POST" && skills?.[0]) {
    const unavailable = await requireActiveTeammate(agent, skills[0]);
    if (unavailable) return unavailable;
    const body = await readJson(request);
    try {
      const skill = await agent.createSkill({
        id: crypto.randomUUID(),
        botId: skills[0],
        name: cleanString(body, "name", 80),
        description: cleanString(body, "description", 300),
        instructions: cleanString(body, "instructions", 4_000)
      });
      return json({ skill }, 201);
    } catch {
      return json({ error: "A skill with this name already exists" }, 409);
    }
  }

  const skill = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/skills\/([^/]+)$/u);
  if (request.method === "DELETE" && skill?.[0] && skill[1]) {
    return (await agent.deleteSkill(skill[1], skill[0]))
      ? json({ deleted: true })
      : json({ error: "Skill not found" }, 404);
  }

  const routines = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/routines$/u);
  if (request.method === "POST" && routines?.[0]) {
    const unavailable = await requireActiveTeammate(agent, routines[0]);
    if (unavailable) return unavailable;
    const body = await readJson(request);
    const intervalMinutes = Number(body.intervalMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 43_200) {
      return json({ error: "intervalMinutes must be from 1 to 43200" }, 400);
    }
    const routine = await agent.createRoutine({
      id: crypto.randomUUID(),
      botId: routines[0],
      name: cleanString(body, "name", 100),
      prompt: cleanString(body, "prompt", 4_000),
      intervalMinutes,
      nextRunAt: nextRun(intervalMinutes)
    });
    await (await teammate(env, routines[0])).reconcileScheduledTasks();
    return json({ routine }, 201);
  }

  const routine = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/routines\/([^/]+)$/u);
  if (routine?.[0] && routine[1] && request.method === "PATCH") {
    const body = await readJson(request);
    if (typeof body.active !== "boolean") return json({ error: "active is required" }, 400);
    if (body.active) {
      const unavailable = await requireActiveTeammate(agent, routine[0]);
      if (unavailable) return unavailable;
    }
    const updated = await agent.setRoutineActive(routine[1], routine[0], body.active);
    if (!updated) return json({ error: "Routine not found" }, 404);
    await (await teammate(env, routine[0])).reconcileScheduledTasks();
    return json({ routine: updated });
  }
  if (routine?.[0] && routine[1] && request.method === "DELETE") {
    if (!(await agent.deleteRoutine(routine[1], routine[0]))) {
      return json({ error: "Routine not found" }, 404);
    }
    await (await teammate(env, routine[0])).reconcileScheduledTasks();
    return json({ deleted: true });
  }

  return null;
}
