import { getAgentByName } from "agents"

import { HQBotAgent } from "./agent"
import type { WorkflowInput } from "./domain/types"
import { listInbox, type MailConfig, type MessageSummary } from "./services/mail"
import { HQBotWorkflow } from "./workflow"

export { HQBotAgent, HQBotWorkflow }

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: jsonHeaders })
}

function required(value: string | undefined, name: string): string {
  const clean = value?.trim()
  if (!clean) throw new Error(`${name} is not configured`)
  return clean
}

function mailConfig(env: Env): MailConfig {
  return {
    origin: required(env.HQBASE_ORIGIN, "HQBASE_ORIGIN"),
    mailboxId: required(env.HQBASE_MAILBOX_ID, "HQBASE_MAILBOX_ID"),
    mailboxAddress: required(env.HQBASE_MAILBOX_ADDRESS, "HQBASE_MAILBOX_ADDRESS"),
    token: required(env.HQBASE_AGENT_TOKEN, "HQBASE_AGENT_TOKEN"),
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

function allowedSender(env: Env, sender: string): boolean {
  const allowed = (env.HQBOT_ALLOWED_SENDERS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(sender.toLowerCase())
}

async function taskIdForMessage(env: Env, message: MessageSummary): Promise<string> {
  const digest = await sha256(`${env.HQBOT_ID}\n${message.id}`)
  return `email-${digest.slice(0, 32)}`
}

async function pollInbox(env: Env): Promise<{ accepted: number; ignored: number }> {
  const config = mailConfig(env)
  const agent = await bot(env)
  let accepted = 0
  let ignored = 0
  for (const message of await listInbox(config)) {
    if (message.direction !== "inbound" || !allowedSender(env, message.fromAddress)) {
      ignored += 1
      continue
    }
    const taskId = await taskIdForMessage(env, message)
    const created = await agent.createEmailTask({
      id: taskId,
      messageId: message.id,
      sender: message.fromAddress,
      subject: message.subject,
      prompt: message.snippet || message.subject,
    })
    if (!created) continue
    await dispatch(env, { taskId, source: "email", messageId: message.id })
    accepted += 1
  }
  return { accepted, ignored }
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

async function handleApi(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireOwner(request, env)
  if (unauthorized) return unauthorized
  const url = new URL(request.url)
  const agent = await bot(env)
  if (request.method === "GET" && url.pathname === "/api/snapshot")
    return json(await agent.getSnapshot())
  if (request.method === "POST" && url.pathname === "/api/poll") return json(await pollInbox(env))
  if (request.method === "POST" && url.pathname === "/api/tasks") {
    const body = await readJson(request)
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
    if (!prompt || prompt.length > 20_000)
      return json({ error: "Prompt must contain 1 to 20000 characters" }, 400)
    const taskId = crypto.randomUUID()
    await agent.createChatTask(taskId, prompt)
    const workflowId = await dispatch(env, { taskId, source: "chat", prompt })
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
          configured: Boolean(
            env.HQBOT_OWNER_TOKEN &&
              env.HQBASE_AGENT_TOKEN &&
              env.HQBASE_ORIGIN &&
              env.HQBASE_MAILBOX_ID &&
              env.HQBASE_MAILBOX_ADDRESS &&
              env.HQBOT_ALLOWED_SENDERS,
          ),
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
