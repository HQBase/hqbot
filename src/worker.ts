import { getAgentByName } from "agents"

import { HQBotAgent } from "./agent"
import type { StoredBotConnection, WorkflowInput } from "./domain/types"
import { defineBot } from "./services/ai"
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
  if (request.method === "POST" && url.pathname === "/api/bots") {
    const body = await readJson(request)
    const brief = cleanString(body, "brief", 2_000)
    const definition = await defineBot(env.AI, env.HQBOT_MODEL_ID, brief)
    const teammate = await agent.createBot(crypto.randomUUID(), definition, brief)
    return json({ teammate }, 201)
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
    const workflowId = await dispatch(env, { taskId, botId, source: "chat", prompt })
    return json({ taskId, workflowId }, 202)
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/artifacts/")) {
    let key: string
    try {
      key = decodeURIComponent(url.pathname.slice("/api/artifacts/".length))
    } catch {
      return json({ error: "Invalid artifact path" }, 400)
    }
    if (!key.startsWith("tasks/") || key.includes("..") || key.includes("\\")) {
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
      if (url.pathname.startsWith("/api/")) return handleApi(request, env)
      return env.ASSETS.fetch(request)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "HQBot request failed" }, 500)
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await pollInbox(env)
  },
} satisfies ExportedHandler<Env>
