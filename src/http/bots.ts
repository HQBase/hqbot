import { defineBot, defineConversationBot } from "../domain/ai";
import { contentTypeForUpload, safeFileName } from "../domain/files";
import { type HQBotModelId, isHQBotModelId } from "../domain/models";
import { listHQBotModels } from "../runtime/model-catalog";
import { saveArtifact } from "../services/artifacts";
import { artifactResponse } from "./artifacts";
import {
  cleanString,
  json,
  optionalString,
  pathMatch,
  readJson,
  requireActiveTeammate,
  teammate,
  workspace
} from "./common";

export async function handleBots(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/models") {
    return json({ models: await listHQBotModels(env.AI) }, 200, {
      "Cache-Control": "private, max-age=300"
    });
  }

  const agent = await workspace(env);

  if (request.method === "GET" && url.pathname === "/api/snapshot") {
    const snapshot = await agent.getSnapshot(url.searchParams.get("botId") ?? undefined);
    return json({ ...snapshot, realtime: { url: `/agents/hqbot-agent/${env.HQBOT_ID}` } });
  }

  if (request.method === "POST" && url.pathname === "/api/bots") {
    const body = await readJson(request);
    const brief = cleanString(body, "brief", 2_000);
    const id = crypto.randomUUID();
    const profile = body.conversation === true ? defineConversationBot(id) : null;
    return json(
      {
        teammate: await agent.createBot(id, profile ?? defineBot(brief), profile?.brief ?? brief)
      },
      201
    );
  }

  const bot = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)$/u);
  if (request.method === "DELETE" && bot?.[0]) {
    await agent.deleteBot(bot[0]);
    return json({ deleted: true });
  }
  if (request.method === "PATCH" && bot?.[0]) {
    const body = await readJson(request);
    const dailyBudgetUsd =
      body.dailyBudgetUsd === undefined ? undefined : Number(body.dailyBudgetUsd);
    if (
      dailyBudgetUsd !== undefined &&
      (!Number.isFinite(dailyBudgetUsd) || dailyBudgetUsd < 0.1 || dailyBudgetUsd > 50)
    ) {
      return json({ error: "dailyBudgetUsd must be from 0.1 to 50" }, 400);
    }
    let modelId: HQBotModelId | undefined;
    if (body.modelId !== undefined) {
      if (
        !isHQBotModelId(body.modelId) ||
        !(await listHQBotModels(env.AI)).some((model) => model.id === body.modelId)
      ) {
        return json({ error: "modelId must be an agent-ready Cloudflare AI model" }, 400);
      }
      modelId = body.modelId;
    }
    let maxSteps: number | null | undefined;
    if (body.maxSteps !== undefined) {
      const requestedMaxSteps = body.maxSteps;
      if (
        requestedMaxSteps !== null &&
        (typeof requestedMaxSteps !== "number" ||
          !Number.isInteger(requestedMaxSteps) ||
          requestedMaxSteps < 1 ||
          requestedMaxSteps > 64)
      ) {
        return json({ error: "maxSteps must be null or an integer from 1 to 64" }, 400);
      }
      maxSteps = requestedMaxSteps;
    }
    let updated = await agent.updateBot(bot[0], {
      name: optionalString(body, "name", 80),
      title: optionalString(body, "title", 120),
      description: optionalString(body, "description", 1_000),
      pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
      dailyBudgetUsd,
      maxSteps,
      modelId
    });
    if (updated && typeof body.hidden === "boolean") {
      updated = await agent.setBotHidden(bot[0], body.hidden);
    }
    return updated ? json({ teammate: updated }) : json({ error: "Teammate not found" }, 404);
  }

  const stopBot = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/stop$/u);
  if (request.method === "POST" && stopBot?.[0]) {
    return (await agent.stopBot(stopBot[0]))
      ? json({ stopped: true })
      : json({ error: "Teammate not found" }, 404);
  }

  const stopTask = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/task\/stop$/u);
  if (request.method === "POST" && stopTask?.[0]) {
    return (await agent.stopBotTask(stopTask[0]))
      ? json({ stopped: true })
      : json({ error: "Teammate not found" }, 404);
  }

  const duplicate = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/duplicate$/u);
  if (request.method === "POST" && duplicate?.[0]) {
    const source = await agent.getBot(duplicate[0]);
    if (!source) return json({ error: "Teammate not found" }, 404);
    const copy = await agent.createBot(
      crypto.randomUUID(),
      {
        name: `${source.name} copy`.slice(0, 80),
        title: source.title,
        description: source.description
      },
      source.brief
    );
    return json({ teammate: copy }, 201);
  }

  const initialMessage = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/messages\/initial$/u);
  if (request.method === "POST" && initialMessage?.[0]) {
    const unavailable = await requireActiveTeammate(agent, initialMessage[0]);
    if (unavailable) return unavailable;
    const body = await readJson(request);
    const submission = await (await teammate(env, initialMessage[0])).submitChat({
      prompt: cleanString(body, "prompt", 20_000),
      submissionId: `first:${initialMessage[0]}`
    });
    return submission
      ? json(submission, 202)
      : json({ error: "This message was stopped before it started" }, 409);
  }

  const files = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/files$/u);
  if (request.method === "POST" && files?.[0]) {
    const unavailable = await requireActiveTeammate(agent, files[0]);
    if (unavailable) return unavailable;
    const form = await request.formData();
    const value = form.get("file");
    if (!value || typeof value === "string") return json({ error: "file is required" }, 400);
    if (value.size === 0 || value.size > 10_000_000) {
      return json({ error: "Files must contain 1 byte to 10 MB" }, 400);
    }
    const name = safeFileName(value.name);
    const contentType = contentTypeForUpload(name, value.type);
    const file = await saveArtifact({
      body: value.stream(),
      botId: files[0],
      bucket: env.ARTIFACTS,
      catalog: agent,
      contentType,
      name,
      size: value.size
    });
    return json({ file }, 201);
  }

  const file = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/files\/([^/]+)$/u);
  if (request.method === "GET" && file?.[0] && file[1]) {
    const stored = await agent.getFile(file[1], file[0]);
    if (!stored) return json({ error: "File not found" }, 404);
    return artifactResponse(env, stored.key, {
      download: url.searchParams.get("download") === "1",
      name: stored.name
    });
  }
  if (request.method === "DELETE" && file?.[0] && file[1]) {
    const deleted = await agent.deleteFile(file[1], file[0]);
    if (!deleted) return json({ error: "File not found" }, 404);
    await env.ARTIFACTS.delete(deleted.key);
    return json({ deleted: true });
  }

  return null;
}
