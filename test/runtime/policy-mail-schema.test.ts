import { describe, expect, it } from "vitest";

import { schemaMigrations } from "../../src/domain/schema";
import { teammateInstructions } from "../../src/runtime/routing";
import {
  emailTaskPrompt,
  existingReply,
  isRelevantInboundChange,
  type MessageChange,
  type MessageDetail,
  parseMailEvent,
  stableMailTaskId
} from "../../src/services/mail";
import { checkSpendPolicy, positiveNumber } from "../../src/workspace/budgets";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql } from "../../src/workspace/sql";

function message(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: "inbound",
    threadId: "thread",
    mailboxId: "mailbox",
    direction: "inbound",
    folder: "inbox",
    fromAddress: "requester@example.com",
    fromName: "Requester",
    to: ["bot@example.com"],
    subject: "Research request",
    snippet: "Please research this",
    receivedAt: "2026-08-30T12:00:01.000Z",
    sentAt: null,
    createdAt: "2026-08-30T12:00:01.000Z",
    textBody: "Please research this",
    messageId: "<inbound@example.com>",
    inReplyTo: null,
    references: [],
    ...overrides
  };
}

interface PolicyInput {
  botExists?: boolean;
  overall?: number;
  bot?: number;
  task?: number;
  taskCount?: number;
  globalBudget?: string;
  botBudget?: number;
  taskBudget?: string;
  taskLimit?: string;
}

function policy(input: PolicyInput = {}) {
  const env = {
    HQBOT_GLOBAL_DAILY_BUDGET_USD: input.globalBudget ?? "5",
    HQBOT_TASK_BUDGET_USD: input.taskBudget ?? "1",
    HQBOT_DAILY_TASK_LIMIT: input.taskLimit ?? "50"
  } as Parameters<typeof checkSpendPolicy>[0];
  const catalog = {
    getBot: () => (input.botExists === false ? null : { dailyBudgetUsd: input.botBudget ?? 2 })
  } as unknown as Parameters<typeof checkSpendPolicy>[1];
  const tasks = {
    getCosts: () => ({
      overall: { estimatedUsd: input.overall ?? 0, inputUnits: 0, outputUnits: 0 },
      selectedBot: { estimatedUsd: input.bot ?? 0, inputUnits: 0, outputUnits: 0 },
      selectedTask: { estimatedUsd: input.task ?? 0, inputUnits: 0, outputUnits: 0 },
      dayStartedAt: "2026-08-30T00:00:00.000Z"
    }),
    countTasksSince: () => input.taskCount ?? 1
  } as unknown as Parameters<typeof checkSpendPolicy>[2];
  return checkSpendPolicy(env, catalog, tasks, "bot", "task");
}

describe("spend policy", () => {
  it.each([
    [{ botExists: false }, "The teammate is not available"],
    [{ overall: 5 }, "The overall daily cost budget has been reached"],
    [{ bot: 2 }, "The teammate daily cost budget has been reached"],
    [{ task: 1 }, "The task cost budget has been reached"],
    [{ taskCount: 51 }, "The daily task limit has been reached"]
  ] as const)("blocks work at a configured boundary", (input, reason) => {
    expect(policy(input)).toEqual({ allowed: false, reason });
  });

  it("allows work below all limits and uses safe numeric fallbacks", () => {
    expect(policy({ overall: 4.99, bot: 1.99, task: 0.99, taskCount: 50 })).toEqual({
      allowed: true,
      reason: null
    });
    expect(positiveNumber("0", 2)).toBe(2);
    expect(positiveNumber("not-a-number", 5)).toBe(5);
  });
});

describe("HQBase email intake", () => {
  it("creates a stable task identity for repeated changes", async () => {
    const connection = { id: "connection", botId: "bot" };
    const first = await stableMailTaskId(connection, "message-1");

    await expect(stableMailTaskId(connection, "message-1")).resolves.toBe(first);
    await expect(stableMailTaskId(connection, "message-2")).resolves.not.toBe(first);
    expect(first).toMatch(/^email-[a-f0-9]{32}$/u);
  });

  it("accepts only new inbound changes for the connected mailbox", () => {
    const accepted: MessageChange = { type: "upsert", message: message() };
    expect(isRelevantInboundChange(accepted, "mailbox", "2026-08-30T12:00:00.000Z")).toBe(true);

    const rejected: MessageChange[] = [
      { type: "delete", messageId: "inbound", mailboxId: "mailbox" },
      { type: "upsert", message: message({ mailboxId: "other" }) },
      { type: "upsert", message: message({ direction: "outbound" }) },
      { type: "upsert", message: message({ receivedAt: "2026-08-30T11:59:59.000Z" }) }
    ];
    for (const change of rejected) {
      expect(isRelevantInboundChange(change, "mailbox", "2026-08-30T12:00:00.000Z")).toBe(false);
    }
  });

  it("parses only supported HQBase change events", () => {
    expect(parseMailEvent('{"type":"changed","topic":"messages"}')).toEqual({
      type: "changed",
      topic: "messages"
    });
    expect(parseMailEvent('{"type":"changed","topic":"mailboxes"}')).not.toBeNull();
    expect(parseMailEvent('{"type":"changed","topic":"unknown"}')).toBeNull();
    expect(parseMailEvent('{"type":"ready","topic":"messages"}')).toBeNull();
    expect(parseMailEvent("not-json")).toBeNull();
  });

  it("builds the full email prompt and approval instructions", () => {
    const mail = message();
    expect(emailTaskPrompt(mail, mail.textBody)).toContain(
      "From: Requester <requester@example.com>"
    );
    expect(emailTaskPrompt(mail, mail.textBody)).toContain("Subject: Research request");
    expect(emailTaskPrompt(mail, mail.textBody)).toContain("Please research this");

    const instructions = teammateInstructions({
      bot: {
        id: "bot",
        name: "Scout",
        title: "Research teammate",
        description: "Finds useful evidence.",
        brief: "Be concise."
      },
      connection: { id: "connection", active: true, mailboxAddress: "bot@example.com" },
      memories: [{ id: "memory", content: "Use primary sources." }],
      skills: [
        { id: "skill", name: "Research", description: "", instructions: "Compare sources." }
      ],
      route: "email"
    });
    expect(instructions).toContain("send_hqbase_reply");
    expect(instructions).toContain("owner must approve");
    expect(instructions).toContain("untrusted data");
    expect(instructions).toContain("read-only browser tools");
    expect(instructions).toContain("bot@example.com");
    expect(instructions).toContain("Use primary sources.");
    expect(instructions).toContain("Compare sources.");
  });

  it("detects an existing reply before another send", () => {
    const inbound = message();
    const reply = message({
      id: "reply",
      direction: "outbound",
      fromAddress: "BOT@example.com",
      references: ["inbound"]
    });
    expect(existingReply([inbound, reply], inbound, "bot@example.com")?.id).toBe("reply");
    expect(existingReply([inbound, reply], inbound, "other@example.com")).toBeNull();
  });
});

describe("schema v5", () => {
  it("keeps the product schema and runtime migration safeguards", () => {
    const versionFive = schemaMigrations.find((migration) => migration.version === 5);
    expect(versionFive).toBeDefined();
    const declared = versionFive?.statements.join("\n") ?? "";
    for (const invariant of [
      "daily_budget_usd REAL NOT NULL DEFAULT 2",
      "change_cursor TEXT",
      "socket_status TEXT NOT NULL DEFAULT 'disconnected'",
      "submission_id TEXT",
      "CREATE TABLE IF NOT EXISTS owner",
      "CREATE TABLE IF NOT EXISTS owner_sessions",
      "CREATE TABLE IF NOT EXISTS usage_events",
      "estimated_usd REAL NOT NULL",
      "CREATE INDEX IF NOT EXISTS usage_day"
    ]) {
      expect(declared).toContain(invariant);
    }

    const executed: string[] = [];
    const fakeSql = ((strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      executed.push(statement);
      return statement.includes("COUNT(*) AS count") ? [{ count: 0 }] : [];
    }) as unknown as Sql;
    migrateWorkspace(fakeSql);
    const runtime = executed.join("\n");
    expect(runtime).toContain("daily_budget_usd REAL NOT NULL DEFAULT 2");
    expect(runtime).toContain("CREATE TABLE IF NOT EXISTS usage_events");
    expect(runtime).toContain("CREATE INDEX IF NOT EXISTS usage_day");
  });
});

describe("schema v6", () => {
  it("adds persistent sign-in attempt limits", () => {
    const versionSix = schemaMigrations.find((migration) => migration.version === 6);
    const declared = versionSix?.statements.join("\n") ?? "";

    expect(declared).toContain("CREATE TABLE IF NOT EXISTS login_limits");
    expect(declared).toContain("blocked_until TEXT");
    expect(declared).toContain("CREATE INDEX IF NOT EXISTS login_limits_updated");
  });
});
