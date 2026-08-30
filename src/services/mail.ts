export interface MailConfig {
  origin: string;
  mailboxId: string;
  mailboxAddress: string;
  token: string;
}

export interface ConnectedMailbox {
  id: string;
  address: string;
  displayName: string;
  isActive: boolean;
  accessLevel: "read" | "agent" | "manager" | null;
}

export function canHandleMail(mailbox: ConnectedMailbox | undefined): mailbox is ConnectedMailbox {
  return mailbox?.isActive === true && mailbox.accessLevel === "agent";
}

export interface MessageSummary {
  id: string;
  threadId: string;
  mailboxId: string | null;
  direction: "inbound" | "outbound";
  folder: string;
  fromAddress: string;
  fromName: string | null;
  to: string[];
  subject: string;
  snippet: string;
  receivedAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface MessageDetail extends MessageSummary {
  textBody: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
}

export type MessageChange =
  | { type: "upsert"; message: MessageSummary }
  | { type: "delete"; messageId: string; mailboxId: string | null };

export interface MessageChangePage {
  changes: MessageChange[];
  nextCursor: string;
  hasMore: boolean;
}

export interface MailEvent {
  type: "changed";
  topic: "messages" | "drafts" | "mailboxes" | "labels";
}

export async function stableMailTaskId(
  connection: { botId: string; id: string },
  messageId: string
): Promise<string> {
  const value = `${connection.botId}\n${connection.id}\n${messageId}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `email-${hex.slice(0, 32)}`;
}

export function emailTaskPrompt(message: MessageSummary, body: string): string {
  return [
    "Reply to this incoming HQBase email.",
    `From: ${message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress}`,
    `Subject: ${message.subject || "(no subject)"}`,
    "",
    body.trim() || message.snippet.trim() || message.subject.trim()
  ].join("\n");
}

export function isNewInboundMessage(message: MessageSummary, connectedAt: string): boolean {
  return message.direction === "inbound" && (message.receivedAt ?? message.createdAt) > connectedAt;
}

export function isRelevantInboundChange(
  change: MessageChange,
  mailboxId: string,
  connectedAt: string
): change is Extract<MessageChange, { type: "upsert" }> {
  return (
    change.type === "upsert" &&
    change.message.mailboxId === mailboxId &&
    isNewInboundMessage(change.message, connectedAt)
  );
}

function mailUrl(config: MailConfig, path: string): URL {
  const origin = new URL(config.origin);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
    throw new Error("HQBase origin must use HTTPS");
  }
  return new URL(path, origin);
}

async function mailJsonResponse<T>(
  config: MailConfig,
  path: string,
  init?: RequestInit
): Promise<{ data: T; headers: Headers }> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${config.token}`);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(mailUrl(config, path), { ...init, headers });
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 2_000_000) throw new Error("HQBase returned an oversized response");
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("HQBase returned an oversized response");
  if (!response.ok) throw new Error(`HQBase request failed with status ${response.status}`);
  return { data: JSON.parse(text) as T, headers: response.headers };
}

async function mailJson<T>(config: MailConfig, path: string, init?: RequestInit): Promise<T> {
  return (await mailJsonResponse<T>(config, path, init)).data;
}

function nextMessagePath(config: MailConfig, link: string | null): string | null {
  const target = /<([^>]+)>\s*;\s*rel="next"/iu.exec(link ?? "")?.[1];
  if (!target) return null;
  const url = new URL(target, config.origin);
  if (
    url.origin !== new URL(config.origin).origin ||
    url.pathname !== "/api/v2/messages" ||
    url.searchParams.get("mailboxId") !== config.mailboxId ||
    url.searchParams.get("folder") !== "inbox"
  ) {
    throw new Error("HQBase returned an invalid next-page link");
  }
  return `${url.pathname}${url.search}`;
}

export async function listInbox(config: MailConfig): Promise<MessageSummary[]> {
  const query = new URLSearchParams({
    folder: "inbox",
    mailboxId: config.mailboxId,
    limit: "100"
  });
  let path: string | null = `/api/v2/messages?${query.toString()}`;
  const messages: MessageSummary[] = [];
  const visited = new Set<string>();
  while (path) {
    if (visited.size >= 100 || visited.has(path)) {
      throw new Error("HQBase message pagination did not finish");
    }
    visited.add(path);
    const page = await mailJsonResponse<MessageSummary[]>(config, path);
    messages.push(...page.data);
    path = nextMessagePath(config, page.headers.get("link"));
  }
  return messages;
}

export function listChanges(config: MailConfig, cursor?: string): Promise<MessageChangePage> {
  const query = new URLSearchParams({ limit: "100" });
  if (cursor) query.set("cursor", cursor);
  return mailJson(config, `/api/v2/changes?${query.toString()}`);
}

export async function openMailEvents(config: MailConfig): Promise<WebSocket> {
  const response = await fetch(mailUrl(config, "/api/v2/events"), {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Upgrade: "websocket"
    }
  });
  const upgrade = response as Response & { webSocket?: WebSocket & { accept(): void } };
  if (upgrade.status !== 101 || !upgrade.webSocket) {
    throw new Error(`HQBase event connection failed with status ${response.status}`);
  }
  upgrade.webSocket.accept();
  return upgrade.webSocket;
}

export function parseMailEvent(value: string): MailEvent | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const event = parsed as Partial<MailEvent>;
    if (
      event.type !== "changed" ||
      !["messages", "drafts", "mailboxes", "labels"].includes(event.topic ?? "")
    ) {
      return null;
    }
    return event as MailEvent;
  } catch {
    return null;
  }
}

export function listMailboxes(origin: string, token: string): Promise<ConnectedMailbox[]> {
  return mailJson({ origin, token, mailboxId: "", mailboxAddress: "" }, "/api/v2/mailboxes");
}

export function getMessage(config: MailConfig, messageId: string): Promise<MessageDetail> {
  return mailJson(config, `/api/v2/messages/${encodeURIComponent(messageId)}`);
}

export function getThread(config: MailConfig, messageId: string): Promise<MessageDetail[]> {
  return mailJson(config, `/api/v2/messages/${encodeURIComponent(messageId)}/thread`);
}

export function existingReply(
  thread: readonly MessageDetail[],
  inbound: Pick<MessageDetail, "id" | "messageId">,
  mailboxAddress: string
): MessageDetail | null {
  const sourceIds = new Set(
    [inbound.id, inbound.messageId].filter((value): value is string => Boolean(value))
  );
  return (
    thread.find(
      (message) =>
        message.direction === "outbound" &&
        message.fromAddress.toLowerCase() === mailboxAddress.toLowerCase() &&
        ((message.inReplyTo !== null && sourceIds.has(message.inReplyTo)) ||
          message.references.some((reference) => sourceIds.has(reference)))
    ) ?? null
  );
}

export async function replyToMessage(
  config: MailConfig,
  messageId: string,
  text: string
): Promise<MessageSummary> {
  return mailJson(config, "/api/v2/reply", {
    method: "POST",
    body: JSON.stringify({
      messageId,
      from: config.mailboxAddress,
      text: text.slice(0, 100_000),
      signature: { mode: "none" }
    })
  });
}
