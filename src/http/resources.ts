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

  const memories = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/memories$/u);
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
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 43_200) {
      return json({ error: "intervalMinutes must be from 15 to 43200" }, 400);
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

  const run = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/routines\/([^/]+)\/run$/u);
  if (request.method === "POST" && run?.[0] && run[1]) {
    const unavailable = await requireActiveTeammate(agent, run[0]);
    if (unavailable) return unavailable;
    const routine = (await agent.listRoutines(run[0])).find((item) => item.id === run[1]);
    if (!routine) return json({ error: "Routine not found" }, 404);
    const taskId = crypto.randomUUID();
    await agent.createChatTask(taskId, run[0], routine.prompt);
    const submission = await (await teammate(env, run[0])).submitTask({
      taskId,
      source: "chat",
      prompt: routine.prompt
    });
    await agent.setTaskSubmission(taskId, submission.submissionId);
    return json({ taskId, submissionId: submission.submissionId }, 202);
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

  const liveView = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/live-view$/u);
  if (request.method === "GET" && liveView?.[0]) {
    const unavailable = await requireActiveTeammate(agent, liveView[0]);
    if (unavailable) return unavailable;
    return json({ liveView: await (await teammate(env, liveView[0])).getLiveView("tab") });
  }
  if (request.method === "DELETE" && liveView?.[0]) {
    await (await teammate(env, liveView[0])).closeLiveView();
    return json({ closed: true });
  }

  return null;
}
