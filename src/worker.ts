import { getAgentByName } from "agents"

import { HQBotAgent } from "./agent"
import { defineBot } from "./domain/ai"
import { mentionedTeammates } from "./domain/collaboration"
import { contentTypeForUpload } from "./domain/files"
import { invokedSkill } from "./domain/skills"
import type {
  BotFile,
  BotRoutine,
  StoredBotConnection,
  StoredComputerState,
  WorkflowInput,
} from "./domain/types"
import { type ComputerAction, operateComputer, stopComputer } from "./services/computer"
import { decryptConnectionToken, encryptConnectionToken } from "./services/crypto"
import {
  isNewInboundMessage,
  listInbox,
  listMailboxes,
  type MailConfig,
  type MessageSummary,
} from "./services/mail"
import { HQBotWorkflow } from "./workflow"

export { HQBotAgent, HQBotWorkflow }

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: jsonHeaders })
}

function publicComputer(state: StoredComputerState) {
  return {
    active: state.active,
    url: state.url,
    screenshotKey: state.screenshotKey,
    expiresAt: state.expiresAt,
    updatedAt: state.updatedAt,
  }
}

function equalTokens(left: string, right: string): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

function requireOwner(request: Request, env: Env): Response | null {
  const expected = env.HQBOT_OWNER_TOKEN?.trim()
  if (!expected) {
    const host = new URL(request.url).hostname
    if (host === "localhost" || host === "127.0.0.1") return null
    return json({ error: "Owner access is not configured" }, 503)
  }
  const authorization = request.headers.get("Authorization")
  const match =
    authorization && authorization.length < 4096
      ? /^Bearer\s+([^\s]+)$/iu.exec(authorization)
      : null
  if (!match || !equalTokens(match[1] ?? "", expected)) {
    return new Response(JSON.stringify({ error: "Owner authorization is required" }), {
      status: 401,
      headers: { ...jsonHeaders, "WWW-Authenticate": 'Bearer realm="HQBot"' },
    })
  }
  return null
}

async function bot(env: Env) {
  return getAgentByName<Env, HQBotAgent>(env.HQBOT_AGENT, env.HQBOT_ID)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function dispatch(env: Env, input: WorkflowInput): Promise<string> {
  const instance = await env.HQBOT_WORKFLOW.create({ id: input.taskId, params: input })
  await (await bot(env)).setWorkflow(input.taskId, instance.id)
  return instance.id
}

function nextRun(intervalMinutes: number, from = new Date()): string {
  return new Date(from.getTime() + intervalMinutes * 60_000).toISOString()
}

async function dispatchRoutine(env: Env, routine: BotRoutine): Promise<string> {
  const agent = await bot(env)
  const taskId = crypto.randomUUID()
  await agent.createChatTask(taskId, routine.botId, routine.prompt)
  await dispatch(env, {
    taskId,
    botId: routine.botId,
    source: "chat",
    prompt: routine.prompt,
  })
  return taskId
}

async function dispatchDueRoutines(env: Env): Promise<number> {
  const agent = await bot(env)
  const routines = await agent.listDueRoutines(new Date().toISOString())
  for (const routine of routines) {
    await agent.advanceRoutine(routine.id, nextRun(routine.intervalMinutes))
    await dispatchRoutine(env, routine)
  }
  return routines.length
}

async function taskIdForMessage(connection: StoredBotConnection, message: MessageSummary) {
  const digest = await sha256(`${connection.botId}\n${connection.id}\n${message.id}`)
  return `email-${digest.slice(0, 32)}`
}

async function mailConfig(env: Env, connection: StoredBotConnection): Promise<MailConfig> {
  return {
    origin: connection.origin,
    mailboxId: connection.mailboxId,
    mailboxAddress: connection.mailboxAddress,
    token: await decryptConnectionToken(
      env.HQBOT_CONNECTION_KEY,
      connection.tokenCiphertext,
      connection.tokenIv,
    ),
  }
}

async function pollInbox(env: Env): Promise<{ accepted: number; ignored: number; failed: number }> {
  const agent = await bot(env)
  let accepted = 0
  let ignored = 0
  let failed = 0
  for (const connection of await agent.listActiveConnections()) {
    try {
      for (const message of await listInbox(await mailConfig(env, connection))) {
        if (!isNewInboundMessage(message, connection.createdAt)) {
          ignored += 1
          continue
        }
        const taskId = await taskIdForMessage(connection, message)
        const created = await agent.createEmailTask({
          id: taskId,
          botId: connection.botId,
          connectionId: connection.id,
          messageId: message.id,
          sender: message.fromAddress,
          subject: message.subject,
          prompt: message.snippet || message.subject,
        })
        if (!created) continue
        await dispatch(env, {
          taskId,
          botId: connection.botId,
          source: "email",
          connectionId: connection.id,
          messageId: message.id,
        })
        accepted += 1
      }
    } catch {
      failed += 1
    }
  }
  return { accepted, ignored, failed }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (length > 40_000) throw new Error("Request body is too large")
  const raw = await request.text()
  if (raw.length > 40_000) throw new Error("Request body is too large")
  const value: unknown = JSON.parse(raw)
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object")
  }
  return value as Record<string, unknown>
}

function cleanString(body: Record<string, unknown>, key: string, limit: number): string {
  const value = typeof body[key] === "string" ? body[key].trim() : ""
  if (!value || value.length > limit)
    throw new Error(`${key} must contain 1 to ${limit} characters`)
  return value
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
  limit: number,
): string | undefined {
  if (body[key] === undefined) return undefined
  return cleanString(body, key, limit)
}

function fileIds(body: Record<string, unknown>): string[] {
  const value = body.fileIds
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.length > 5 ||
    value.some((id) => typeof id !== "string" || id.length > 100)
  ) {
    throw new Error("fileIds must contain at most five file IDs")
  }
  return value
}

function safeFileName(value: string): string {
  const clean = value
    .replace(/[^a-zA-Z0-9._ -]/gu, "_")
    .slice(0, 120)
    .trim()
  return clean || "attachment"
}

async function promptWithFiles(env: Env, prompt: string, files: BotFile[]): Promise<string> {
  if (files.length === 0) return prompt
  const sections: string[] = []
  let remaining = 16_000
  for (const file of files) {
    if (remaining <= 0) break
    const readable =
      file.contentType.startsWith("text/") ||
      ["application/json", "application/xml"].includes(file.contentType)
    if (!readable || file.size > 100_000) {
      sections.push(`[Attached file: ${file.name} (${file.contentType})]`)
      continue
    }
    const object = await env.ARTIFACTS.get(file.key)
    if (!object) continue
    const content = (await object.text()).slice(0, remaining)
    remaining -= content.length
    sections.push(`Attached file: ${file.name}\n${content}`)
  }
  return sections.length > 0 ? `${prompt}\n\n${sections.join("\n\n")}` : prompt
}

function canonicalOrigin(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("HQBase URL must be an HTTPS origin without a path")
  }
  return url.origin
}

async function connectHQBase(request: Request, env: Env, botId: string): Promise<Response> {
  const agent = await bot(env)
  if (!(await agent.hasBot(botId))) return json({ error: "Teammate not found" }, 404)
  const body = await readJson(request)
  const origin = canonicalOrigin(cleanString(body, "origin", 500))
  const token = cleanString(body, "token", 2_000)
  const mailboxes = await listMailboxes(origin, token)
  if (mailboxes.length !== 1) {
    return json({ error: "Use a mailbox-scoped HQBase agent connection" }, 400)
  }
  const mailbox = mailboxes[0]
  if (!mailbox?.isActive || !["agent", "manager"].includes(mailbox.accessLevel ?? "")) {
    return json({ error: "This HQBase connection cannot handle mail" }, 400)
  }
  const encrypted = await encryptConnectionToken(env.HQBOT_CONNECTION_KEY, token)
  try {
    const connection = await agent.connectHQBase({
      id: crypto.randomUUID(),
      botId,
      origin,
      mailboxId: mailbox.id,
      mailboxAddress: mailbox.address,
      mailboxName: mailbox.displayName || mailbox.address,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
    })
    return json({ connection }, 201)
  } catch {
    return json({ error: "This teammate or mailbox already has an HQBase connection" }, 409)
  }
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireOwner(request, env)
  if (unauthorized) return unauthorized
  const url = new URL(request.url)
  const agent = await bot(env)

  if (request.method === "GET" && url.pathname === "/api/snapshot") {
    return json(await agent.getSnapshot(url.searchParams.get("botId") ?? undefined))
  }
  if (request.method === "POST" && url.pathname === "/api/poll") return json(await pollInbox(env))
  if (request.method === "POST" && url.pathname === "/api/computer/action") {
    const body = await readJson(request)
    const type = body.type
    let action: ComputerAction
    if (type === "navigate") {
      action = { type, url: cleanString(body, "url", 2_000) }
    } else if (type === "click") {
      const x = Number(body.x)
      const y = Number(body.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return json({ error: "click requires numeric x and y coordinates" }, 400)
      }
      action = { type, x, y }
    } else if (type === "type") {
      action = { type, text: cleanString(body, "text", 2_000) }
    } else if (
      type === "key" &&
      ["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown"].includes(String(body.key))
    ) {
      action = {
        type,
        key: String(body.key) as "Enter" | "Tab" | "Escape" | "Backspace" | "ArrowUp" | "ArrowDown",
      }
    } else if (type === "refresh") {
      action = { type }
    } else {
      return json({ error: "Unsupported computer action" }, 400)
    }
    const state = await operateComputer(
      env.BROWSER,
      env.ARTIFACTS,
      env.HQBOT_CONNECTION_KEY,
      await agent.getComputerState(),
      action,
    )
    await agent.saveComputerState(state)
    return json({ computer: publicComputer(await agent.getComputerState()) })
  }
  if (request.method === "POST" && url.pathname === "/api/computer/stop") {
    const state = await stopComputer(env.BROWSER, await agent.getComputerState())
    await agent.saveComputerState(state)
    return json({ computer: publicComputer(await agent.getComputerState()) })
  }
  if (request.method === "POST" && url.pathname === "/api/bots") {
    const body = await readJson(request)
    const brief = cleanString(body, "brief", 2_000)
    const definition = defineBot(brief)
    const teammate = await agent.createBot(crypto.randomUUID(), definition, brief)
    return json({ teammate }, 201)
  }

  const botMatch = /^\/api\/bots\/([^/]+)$/u.exec(url.pathname)
  if (request.method === "PATCH" && botMatch?.[1]) {
    const botId = decodeURIComponent(botMatch[1])
    const body = await readJson(request)
    const pinned = typeof body.pinned === "boolean" ? body.pinned : undefined
    const hidden = typeof body.hidden === "boolean" ? body.hidden : undefined
    const teammate = await agent.updateBot(botId, {
      name: optionalString(body, "name", 80),
      title: optionalString(body, "title", 120),
      description: optionalString(body, "description", 1_000),
      pinned,
      hidden,
    })
    return teammate ? json({ teammate }) : json({ error: "Teammate not found" }, 404)
  }

  const duplicateMatch = /^\/api\/bots\/([^/]+)\/duplicate$/u.exec(url.pathname)
  if (request.method === "POST" && duplicateMatch?.[1]) {
    const source = await agent.getBot(decodeURIComponent(duplicateMatch[1]))
    if (!source) return json({ error: "Teammate not found" }, 404)
    const teammate = await agent.createBot(
      crypto.randomUUID(),
      {
        name: `${source.name} copy`.slice(0, 80),
        title: source.title,
        description: source.description,
      },
      source.brief,
    )
    return json({ teammate }, 201)
  }

  const memoryCollectionMatch = /^\/api\/bots\/([^/]+)\/memories$/u.exec(url.pathname)
  if (request.method === "POST" && memoryCollectionMatch?.[1]) {
    const botId = decodeURIComponent(memoryCollectionMatch[1])
    if (!(await agent.hasBot(botId))) return json({ error: "Teammate not found" }, 404)
    const body = await readJson(request)
    const memory = await agent.createMemory(
      crypto.randomUUID(),
      botId,
      cleanString(body, "content", 500),
    )
    return json({ memory }, 201)
  }

  const skillCollectionMatch = /^\/api\/bots\/([^/]+)\/skills$/u.exec(url.pathname)
  if (request.method === "POST" && skillCollectionMatch?.[1]) {
    const botId = decodeURIComponent(skillCollectionMatch[1])
    if (!(await agent.hasBot(botId))) return json({ error: "Teammate not found" }, 404)
    const body = await readJson(request)
    try {
      const skill = await agent.createSkill({
        id: crypto.randomUUID(),
        botId,
        name: cleanString(body, "name", 80),
        description: cleanString(body, "description", 300),
        instructions: cleanString(body, "instructions", 4_000),
      })
      return json({ skill }, 201)
    } catch {
      return json({ error: "A skill with this name already exists" }, 409)
    }
  }

  const skillMatch = /^\/api\/bots\/([^/]+)\/skills\/([^/]+)$/u.exec(url.pathname)
  if (request.method === "DELETE" && skillMatch?.[1] && skillMatch[2]) {
    const deleted = await agent.deleteSkill(
      decodeURIComponent(skillMatch[2]),
      decodeURIComponent(skillMatch[1]),
    )
    return deleted ? json({ deleted: true }) : json({ error: "Skill not found" }, 404)
  }

  const memoryMatch = /^\/api\/bots\/([^/]+)\/memories\/([^/]+)$/u.exec(url.pathname)
  if (request.method === "DELETE" && memoryMatch?.[1] && memoryMatch[2]) {
    const deleted = await agent.deleteMemory(
      decodeURIComponent(memoryMatch[2]),
      decodeURIComponent(memoryMatch[1]),
    )
    return deleted ? json({ deleted: true }) : json({ error: "Memory not found" }, 404)
  }

  const routineCollectionMatch = /^\/api\/bots\/([^/]+)\/routines$/u.exec(url.pathname)
  if (request.method === "POST" && routineCollectionMatch?.[1]) {
    const botId = decodeURIComponent(routineCollectionMatch[1])
    if (!(await agent.hasBot(botId))) return json({ error: "Teammate not found" }, 404)
    const body = await readJson(request)
    const intervalMinutes = Number(body.intervalMinutes)
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 43_200) {
      return json({ error: "intervalMinutes must be from 15 to 43200" }, 400)
    }
    const routine = await agent.createRoutine({
      id: crypto.randomUUID(),
      botId,
      name: cleanString(body, "name", 100),
      prompt: cleanString(body, "prompt", 4_000),
      intervalMinutes,
      nextRunAt: nextRun(intervalMinutes),
    })
    return json({ routine }, 201)
  }

  const routineRunMatch = /^\/api\/bots\/([^/]+)\/routines\/([^/]+)\/run$/u.exec(url.pathname)
  if (request.method === "POST" && routineRunMatch?.[1] && routineRunMatch[2]) {
    const botId = decodeURIComponent(routineRunMatch[1])
    const routine = (await agent.listRoutines(botId)).find(
      (candidate) => candidate.id === decodeURIComponent(routineRunMatch[2] ?? ""),
    )
    if (!routine) return json({ error: "Routine not found" }, 404)
    return json({ taskId: await dispatchRoutine(env, routine) }, 202)
  }

  const routineMatch = /^\/api\/bots\/([^/]+)\/routines\/([^/]+)$/u.exec(url.pathname)
  if (routineMatch?.[1] && routineMatch[2]) {
    const botId = decodeURIComponent(routineMatch[1])
    const routineId = decodeURIComponent(routineMatch[2])
    if (request.method === "PATCH") {
      const body = await readJson(request)
      if (typeof body.active !== "boolean") return json({ error: "active is required" }, 400)
      const routine = await agent.setRoutineActive(routineId, botId, body.active)
      return routine ? json({ routine }) : json({ error: "Routine not found" }, 404)
    }
    if (request.method === "DELETE") {
      return (await agent.deleteRoutine(routineId, botId))
        ? json({ deleted: true })
        : json({ error: "Routine not found" }, 404)
    }
  }

  const fileCollectionMatch = /^\/api\/bots\/([^/]+)\/files$/u.exec(url.pathname)
  if (request.method === "POST" && fileCollectionMatch?.[1]) {
    const botId = decodeURIComponent(fileCollectionMatch[1])
    if (!(await agent.hasBot(botId))) return json({ error: "Teammate not found" }, 404)
    const form = await request.formData()
    const value = form.get("file")
    if (!value || typeof value === "string") return json({ error: "file is required" }, 400)
    if (value.size === 0 || value.size > 10_000_000) {
      return json({ error: "Files must contain 1 byte to 10 MB" }, 400)
    }
    const id = crypto.randomUUID()
    const name = safeFileName(value.name)
    const contentType = contentTypeForUpload(name, value.type)
    const key = `files/${botId}/${id}/${name}`
    await env.ARTIFACTS.put(key, value.stream(), { httpMetadata: { contentType } })
    const file = await agent.createFile({ id, botId, key, name, contentType, size: value.size })
    return json({ file }, 201)
  }

  const fileMatch = /^\/api\/bots\/([^/]+)\/files\/([^/]+)$/u.exec(url.pathname)
  if (request.method === "DELETE" && fileMatch?.[1] && fileMatch[2]) {
    const file = await agent.deleteFile(
      decodeURIComponent(fileMatch[2]),
      decodeURIComponent(fileMatch[1]),
    )
    if (!file) return json({ error: "File not found" }, 404)
    await env.ARTIFACTS.delete(file.key)
    return json({ deleted: true })
  }

  const approvalMatch = /^\/api\/tasks\/([^/]+)\/approval$/u.exec(url.pathname)
  if (request.method === "POST" && approvalMatch?.[1]) {
    const taskId = decodeURIComponent(approvalMatch[1])
    const task = await agent.getTask(taskId)
    if (!task) return json({ error: "Task not found" }, 404)
    if (task.status !== "awaiting_approval" || !task.workflowId) {
      return json({ error: "This task is not waiting for approval" }, 409)
    }
    const body = await readJson(request)
    if (typeof body.approved !== "boolean") {
      return json({ error: "approved must be true or false" }, 400)
    }
    const instance = await env.HQBOT_WORKFLOW.get(task.workflowId)
    await instance.sendEvent({ type: "approval", payload: { approved: body.approved } })
    return json({ accepted: true })
  }

  const connectionMatch = /^\/api\/bots\/([^/]+)\/connections\/hqbase$/u.exec(url.pathname)
  if (request.method === "POST" && connectionMatch?.[1]) {
    return connectHQBase(request, env, decodeURIComponent(connectionMatch[1]))
  }

  const taskMatch = /^\/api\/bots\/([^/]+)\/tasks$/u.exec(url.pathname)
  if (request.method === "POST" && taskMatch?.[1]) {
    const botId = decodeURIComponent(taskMatch[1])
    if (!(await agent.hasBot(botId))) return json({ error: "Teammate not found" }, 404)
    const body = await readJson(request)
    const prompt = cleanString(body, "prompt", 20_000)
    const taskId = crypto.randomUUID()
    await agent.createChatTask(taskId, botId, prompt)
    const attachedFiles = await agent.attachFiles(botId, taskId, fileIds(body))
    const workflowPrompt = await promptWithFiles(env, prompt, attachedFiles)
    const collaborators = mentionedTeammates(prompt, botId, await agent.listBots())
    const skill = invokedSkill(prompt, await agent.listSkills(botId))
    const workflowId = await dispatch(env, {
      taskId,
      botId,
      source: "chat",
      prompt: workflowPrompt,
      collaboratorIds: collaborators.map((candidate) => candidate.id),
      skillId: skill?.id,
    })
    return json({ taskId, workflowId }, 202)
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/artifacts/")) {
    let key: string
    try {
      key = decodeURIComponent(url.pathname.slice("/api/artifacts/".length))
    } catch {
      return json({ error: "Invalid artifact path" }, 400)
    }
    if (
      (!key.startsWith("tasks/") && !key.startsWith("files/") && !key.startsWith("computer/")) ||
      key.includes("..") ||
      key.includes("\\")
    ) {
      return json({ error: "Invalid artifact path" }, 400)
    }
    const object = await env.ARTIFACTS.get(key)
    if (!object) return json({ error: "Artifact not found" }, 404)
    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set("Cache-Control", "private, no-store")
    return new Response(object.body, { headers })
  }
  return json({ error: "Not found" }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    try {
      if (url.pathname === "/health") {
        return json({
          ok: true,
          configured: Boolean(env.HQBOT_OWNER_TOKEN && env.HQBOT_CONNECTION_KEY),
        })
      }
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env)
      return env.ASSETS.fetch(request)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "HQBot request failed" }, 500)
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await Promise.all([pollInbox(env), dispatchDueRoutines(env)])
  },
} satisfies ExportedHandler<Env>
