export interface MailConfig {
  origin: string
  mailboxId: string
  mailboxAddress: string
  token: string
}

export interface MessageSummary {
  id: string
  threadId: string
  mailboxId: string | null
  direction: "inbound" | "outbound"
  folder: string
  fromAddress: string
  fromName: string | null
  to: string[]
  subject: string
  snippet: string
  receivedAt: string | null
  sentAt: string | null
  createdAt: string
}

export interface MessageDetail extends MessageSummary {
  textBody: string
  messageId: string | null
  inReplyTo: string | null
  references: string[]
}

function mailUrl(config: MailConfig, path: string): URL {
  const origin = new URL(config.origin)
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
    throw new Error("HQBase origin must use HTTPS")
  }
  return new URL(path, origin)
}

async function mailJson<T>(config: MailConfig, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${config.token}`)
  headers.set("Accept", "application/json")
  if (init?.body) headers.set("Content-Type", "application/json")
  const response = await fetch(mailUrl(config, path), { ...init, headers })
  const length = Number(response.headers.get("content-length") ?? 0)
  if (length > 2_000_000) throw new Error("HQBase returned an oversized response")
  const text = await response.text()
  if (text.length > 2_000_000) throw new Error("HQBase returned an oversized response")
  if (!response.ok) throw new Error(`HQBase request failed with status ${response.status}`)
  return JSON.parse(text) as T
}

export function listInbox(config: MailConfig): Promise<MessageSummary[]> {
  const query = new URLSearchParams({
    folder: "inbox",
    mailboxId: config.mailboxId,
    limit: "20",
  })
  return mailJson(config, `/api/v2/messages?${query.toString()}`)
}

export function getMessage(config: MailConfig, messageId: string): Promise<MessageDetail> {
  return mailJson(config, `/api/v2/messages/${encodeURIComponent(messageId)}`)
}

export function getThread(config: MailConfig, messageId: string): Promise<MessageDetail[]> {
  return mailJson(config, `/api/v2/messages/${encodeURIComponent(messageId)}/thread`)
}

export function existingReply(
  thread: readonly MessageDetail[],
  inbound: Pick<MessageDetail, "id" | "messageId">,
  mailboxAddress: string,
): MessageDetail | null {
  const sourceIds = new Set(
    [inbound.id, inbound.messageId].filter((value): value is string => Boolean(value)),
  )
  return (
    thread.find(
      (message) =>
        message.direction === "outbound" &&
        message.fromAddress.toLowerCase() === mailboxAddress.toLowerCase() &&
        ((message.inReplyTo !== null && sourceIds.has(message.inReplyTo)) ||
          message.references.some((reference) => sourceIds.has(reference))),
    ) ?? null
  )
}

export async function replyToMessage(
  config: MailConfig,
  messageId: string,
  text: string,
): Promise<MessageSummary> {
  return mailJson(config, "/api/v2/reply", {
    method: "POST",
    body: JSON.stringify({
      messageId,
      from: config.mailboxAddress,
      text: text.slice(0, 100_000),
      signature: { mode: "none" },
    }),
  })
}
