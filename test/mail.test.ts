import { describe, expect, it } from "vitest"

import { existingReply, type MessageDetail } from "../src/services/mail"

function message(overrides: Partial<MessageDetail>): MessageDetail {
  return {
    id: "message",
    threadId: "thread",
    mailboxId: "mailbox",
    direction: "inbound",
    folder: "inbox",
    fromAddress: "requester@example.com",
    fromName: null,
    to: ["hqbot@example.com"],
    subject: "Research request",
    snippet: "Please research this",
    receivedAt: "2026-08-30T00:00:00.000Z",
    sentAt: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    textBody: "Please research this",
    messageId: "<inbound@example.com>",
    inReplyTo: null,
    references: [],
    ...overrides,
  }
}

describe("existingReply", () => {
  it("finds a reply by the RFC message ID", () => {
    const inbound = message({ id: "inbound" })
    const reply = message({
      id: "reply",
      direction: "outbound",
      fromAddress: "HQBOT@example.com",
      inReplyTo: "<inbound@example.com>",
    })
    expect(existingReply([inbound, reply], inbound, "hqbot@example.com")?.id).toBe("reply")
  })

  it("does not treat an unrelated outbound message as the reply", () => {
    const inbound = message({ id: "inbound" })
    const outbound = message({
      id: "outbound",
      direction: "outbound",
      fromAddress: "hqbot@example.com",
      inReplyTo: "<other@example.com>",
    })
    expect(existingReply([inbound, outbound], inbound, "hqbot@example.com")).toBeNull()
  })
})
