import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canHandleMail,
  existingReply,
  isNewInboundMessage,
  listInbox,
  type MessageDetail
} from "../src/services/mail";

describe("canHandleMail", () => {
  const mailbox = {
    id: "mailbox",
    address: "hqbot@example.com",
    displayName: "HQBot",
    isActive: true
  };

  it("accepts only an active mailbox agent credential", () => {
    expect(canHandleMail({ ...mailbox, accessLevel: "agent" })).toBe(true);
    expect(canHandleMail({ ...mailbox, accessLevel: "manager" })).toBe(false);
    expect(canHandleMail({ ...mailbox, accessLevel: "read" })).toBe(false);
    expect(canHandleMail({ ...mailbox, accessLevel: "agent", isActive: false })).toBe(false);
  });
});

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
    ...overrides
  };
}

describe("existingReply", () => {
  it("finds a reply by the RFC message ID", () => {
    const inbound = message({ id: "inbound" });
    const reply = message({
      id: "reply",
      direction: "outbound",
      fromAddress: "HQBOT@example.com",
      inReplyTo: "<inbound@example.com>"
    });
    expect(existingReply([inbound, reply], inbound, "hqbot@example.com")?.id).toBe("reply");
  });

  it("does not treat an unrelated outbound message as the reply", () => {
    const inbound = message({ id: "inbound" });
    const outbound = message({
      id: "outbound",
      direction: "outbound",
      fromAddress: "hqbot@example.com",
      inReplyTo: "<other@example.com>"
    });
    expect(existingReply([inbound, outbound], inbound, "hqbot@example.com")).toBeNull();
  });
});

describe("isNewInboundMessage", () => {
  it("does not run the mailbox backlog when a teammate first connects", () => {
    const connectedAt = "2026-08-30T12:00:00.000Z";
    expect(
      isNewInboundMessage(message({ receivedAt: "2026-08-30T11:59:59.000Z" }), connectedAt)
    ).toBe(false);
    expect(
      isNewInboundMessage(message({ receivedAt: "2026-08-30T12:00:01.000Z" }), connectedAt)
    ).toBe(true);
    expect(
      isNewInboundMessage(
        message({ direction: "outbound", receivedAt: "2026-08-30T12:00:01.000Z" }),
        connectedAt
      )
    ).toBe(false);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("listInbox", () => {
  it("follows the complete HQBase bootstrap list without forwarding credentials", async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        const cursor = new URL(request.url).searchParams.get("cursor");
        return Response.json(cursor ? [message({ id: "second" })] : [message({ id: "first" })], {
          headers: cursor
            ? undefined
            : {
                Link: '<https://mail.example.com/api/v2/messages?mailboxId=mailbox&folder=inbox&limit=100&cursor=next>; rel="next"'
              }
        });
      })
    );

    await expect(
      listInbox({
        origin: "https://mail.example.com",
        mailboxId: "mailbox",
        mailboxAddress: "hqbot@example.com",
        token: "secret"
      })
    ).resolves.toEqual([
      expect.objectContaining({ id: "first" }),
      expect.objectContaining({ id: "second" })
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret");
    expect(new URL(requests[0]?.url ?? "").searchParams.get("limit")).toBe("100");
  });

  it("rejects a next-page link on another origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([], {
          headers: {
            Link: '<https://attacker.example/api/v2/messages?mailboxId=mailbox&folder=inbox&cursor=next>; rel="next"'
          }
        })
      )
    );
    await expect(
      listInbox({
        origin: "https://mail.example.com",
        mailboxId: "mailbox",
        mailboxAddress: "hqbot@example.com",
        token: "secret"
      })
    ).rejects.toThrow("invalid next-page link");
  });
});
