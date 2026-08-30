import { defineBot, defineConversationBot } from "../domain/ai";
import { contentTypeForUpload } from "../domain/files";
import { ARCHIVED_TEAMMATE_ERROR } from "../domain/lifecycle";
import { isHQBotModelId } from "../domain/models";
import type { BotFile } from "../domain/types";
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

function numberSetting(value: string, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function fileIds(body: Record<string, unknown>): string[] {
  const value = body.fileIds;
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 5 ||
    value.some((id) => typeof id !== "string" || id.length > 100)
  ) {
    throw new Error("fileIds must contain at most five file IDs");
  }
  return value;
}

async function promptWithFiles(env: Env, prompt: string, files: BotFile[]): Promise<string> {
  if (files.length === 0) return prompt;
  const sections: string[] = [];
  let remaining = 16_000;
  for (const file of files) {
    if (remaining <= 0) break;
    const readable =
      file.contentType.startsWith("text/") ||
      ["application/json", "application/xml"].includes(file.contentType);
    if (!readable || file.size > 100_000) {
      sections.push(`[Attached file: ${file.name} (${file.contentType})]`);
      continue;
    }
    const object = await env.ARTIFACTS.get(file.key);
    if (!object) continue;
    const content = (await object.text()).slice(0, remaining);
    remaining -= content.length;
    sections.push(`Attached file: ${file.name}\n${content}`);
  }
  return sections.length > 0 ? `${prompt}\n\n${sections.join("\n\n")}` : prompt;
}

function safeFileName(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._ -]/gu, "_")
      .slice(0, 120)
      .trim() || "attachment"
  );
}

export async function handleBots(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const agent = await workspace(env);

  if (request.method === "GET" && url.pathname === "/api/snapshot") {
    const snapshot = await agent.getSnapshot(url.searchParams.get("botId") ?? undefined);
    return json({ ...snapshot, realtime: { url: `/agents/hqbot-agent/${env.HQBOT_ID}` } });
  }

  if (request.method === "POST" && url.pathname === "/api/bots") {
    const body = await readJson(request);
    const brief = cleanString(body, "brief", 2_000);
    const profile = body.conversation === true ? defineConversationBot(brief) : null;
    return json(
      {
        teammate: await agent.createBot(
          crypto.randomUUID(),
          profile ?? defineBot(brief),
          profile?.brief ?? brief
        )
      },
      201
    );
  }

  const bot = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)$/u);
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
    if (body.modelId !== undefined && !isHQBotModelId(body.modelId)) {
      return json({ error: "modelId must be a supported Workers AI model" }, 400);
    }
    let updated = await agent.updateBot(bot[0], {
      name: optionalString(body, "name", 80),
      title: optionalString(body, "title", 120),
      description: optionalString(body, "description", 1_000),
      pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
      dailyBudgetUsd,
      modelId: body.modelId
    });
    if (updated && typeof body.hidden === "boolean") {
      updated = await agent.setBotHidden(bot[0], body.hidden);
    }
    return updated ? json({ teammate: updated }) : json({ error: "Teammate not found" }, 404);
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

  const task = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/tasks$/u);
  if (request.method === "POST" && task?.[0]) {
    const selected = await agent.getBot(task[0]);
    if (!selected) return json({ error: "Teammate not found" }, 404);
    if (selected.hidden) return json({ error: ARCHIVED_TEAMMATE_ERROR }, 409);
    const snapshot = await agent.getSnapshot(task[0]);
    const globalBudget = numberSetting(env.HQBOT_GLOBAL_DAILY_BUDGET_USD, 5);
    if (
      snapshot.costs.overall.estimatedUsd >= globalBudget ||
      snapshot.costs.selectedBot.estimatedUsd >= selected.dailyBudgetUsd
    ) {
      return json({ error: "The daily cost budget has been reached" }, 429);
    }
    const body = await readJson(request);
    const prompt = cleanString(body, "prompt", 20_000);
    const taskId = crypto.randomUUID();
    await agent.createChatTask(taskId, task[0], prompt);
    const files = await agent.attachFiles(task[0], taskId, fileIds(body));
    const submission = await (await teammate(env, task[0])).submitTask({
      taskId,
      source: "chat",
      prompt: await promptWithFiles(env, prompt, files)
    });
    await agent.setTaskSubmission(taskId, submission.submissionId);
    return json({ taskId, submissionId: submission.submissionId }, 202);
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
    return json(submission, 202);
  }

  const stop = pathMatch(url.pathname, /^\/api\/tasks\/([^/]+)\/stop$/u);
  if (request.method === "POST" && stop?.[0]) {
    const current = await agent.getTask(stop[0]);
    if (!current) return json({ error: "Task not found" }, 404);
    if (!(await agent.cancelTask(current.id))) {
      return json({ error: "This task can no longer be stopped" }, 409);
    }
    await (await teammate(env, current.botId)).cancelTask(current.id);
    return json({ stopped: true });
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
    const id = crypto.randomUUID();
    const name = safeFileName(value.name);
    const contentType = contentTypeForUpload(name, value.type);
    const key = `files/${files[0]}/${id}/${name}`;
    await env.ARTIFACTS.put(key, value.stream(), { httpMetadata: { contentType } });
    const file = await agent.createFile({
      id,
      botId: files[0],
      key,
      name,
      contentType,
      size: value.size
    });
    return json({ file }, 201);
  }

  const file = pathMatch(url.pathname, /^\/api\/bots\/([^/]+)\/files\/([^/]+)$/u);
  if (request.method === "DELETE" && file?.[0] && file[1]) {
    const deleted = await agent.deleteFile(file[1], file[0]);
    if (!deleted) return json({ error: "File not found" }, 404);
    await env.ARTIFACTS.delete(deleted.key);
    return json({ deleted: true });
  }

  return null;
}
