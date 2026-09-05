import { automationInput } from "../domain/automations";
import {
  cleanString,
  json,
  pathMatch,
  readJson,
  requireActiveTeammate,
  teammate,
  workspace
} from "./common";

export async function handleAutomations(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const run = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/routines\/([^/]+)\/(run|runs)$/u);
  if (url.pathname !== "/api/automations" && !run) return null;
  const agent = await workspace(env);
  try {
    if (url.pathname === "/api/automations") {
      if (request.method === "GET")
        return json({
          routines: await agent.listAutomations(url.searchParams.get("botId") ?? undefined)
        });
      if (request.method === "POST") {
        const routine = await agent.saveAutomation(automationInput.parse(await readJson(request)));
        await (await teammate(env, routine.botId)).reconcileScheduledTasks();
        return json({ routine });
      }
    }
    if (run?.[0] && run[1]) {
      const unavailable = await requireActiveTeammate(agent, run[0]);
      if (unavailable) return unavailable;
      if (run[2] === "runs" && request.method === "GET")
        return json({
          runs: await agent.listRoutineRuns(run[0], run[1]),
          nextRunAt: await (await teammate(env, run[0])).getRoutineNextRun(run[1])
        });
      if (run[2] === "run" && request.method === "POST") {
        const body = await readJson(request, true);
        return json(
          {
            run: await agent.queueRoutineRun(
              run[0],
              run[1],
              body.id === undefined ? crypto.randomUUID() : cleanString(body, "id", 200),
              "manual"
            )
          },
          202
        );
      }
    }
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : "The routine change failed" },
      400
    );
  }
  return json({ error: "Unsupported routine action" }, 400);
}
