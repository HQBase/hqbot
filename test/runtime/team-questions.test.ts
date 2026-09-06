import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QUESTION_TIMEOUT_MS, teamQuestions } from "../../src/domain/team-questions";
import { teamWorkInput } from "../../src/domain/team-work";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { ensureChief } from "../../src/workspace/chief";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";
import { WorkspaceTeamPolicy } from "../../src/workspace/team-policy";
import { TeamWorkDelivery } from "../../src/workspace/team-work-delivery";

let db: DatabaseSync;
let sql: Sql;
let work: TeamWorkDelivery;
let catalog: WorkspaceCatalog;
let chief: string;
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing test fixture");
  return value;
}
const assignment = (botId: string) =>
  required(required(work.get("work")).assignments.find((item) => item.botId === botId));
const turn = (botId: string) => required(work.pending().find((item) => item.bot_id === botId)).id;
const ask = (key = "eligibility", botId = "researcher", sender = "writer") =>
  work.ask(sender, "work", {
    action: "ask",
    key,
    botId,
    question: "Does the directory accept self-hosted projects?"
  });
const answer = (
  questionId: string,
  text = "Yes. The saved directory requirements explicitly allow them."
) => work.answer("researcher", "work", { action: "answer", questionId, answer: text });

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateWorkspace(sql);
  catalog = new WorkspaceCatalog(sql);
  for (const id of ["writer", "researcher", "third", "outsider"])
    catalog.createBot(id, { name: id, title: id, description: id }, id, "test", 2);
  chief = required(ensureChief(sql, "test", 2)).id;
  work = new TeamWorkDelivery(sql);
  work.start(
    chief,
    "work",
    {
      action: "start",
      goal: "Prepare a directory submission",
      criteria: ["Verified copy"],
      budgetUsd: 0.1
    },
    1
  );
  for (const botId of ["writer", "researcher", "third"]) {
    const item = work.assign(chief, "work", {
      action: "assign",
      key: botId,
      botId,
      instruction: `Check ${botId}`,
      criterion: "Verified evidence"
    });
    work.submitted(`assignment:${item.id}`);
  }
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

it("saves one question across retries and restart, then resumes the waiting assignment exactly once", () => {
  const { questionId } = ask();
  expect(ask().questionId).toBe(questionId);
  expect(teamQuestions(work.get("work")?.updates)).toHaveLength(1);
  work.wait("writer", "work");
  work.finishTurn(turn("writer"), "writer", "Waiting for evidence", false);
  expect(assignment("writer").state).toBe("submitted");
  work.queueQuestionTurns("work");
  work.queueManagers("work");
  expect(work.pending().filter((item) => item.bot_id === "writer")).toHaveLength(0);
  work = new TeamWorkDelivery(sql);
  const briefing = required(work.briefing("researcher", "work")).instructions;
  expect(briefing).toContain(questionId);
  expect(briefing).toContain("untrusted context");
  answer(questionId);
  answer(questionId);
  work.queueQuestionTurns("work");
  work.queueQuestionTurns("work");
  expect(work.pending().filter((item) => item.bot_id === "writer")).toHaveLength(1);
  expect(required(work.briefing("writer", "work")).instructions).toContain("explicitly allow");
  const resumed = turn("writer");
  work.submitted(resumed);
  work.finishTurn(resumed, "writer", "Prepared verified copy", false);
  expect(assignment("writer")).toMatchObject({
    state: "returned",
    result: "Prepared verified copy"
  });
  expect(work.get("work")?.assignments).toHaveLength(3);
  expect(catalog.listMemories("writer")).toEqual([]);
});

it("keeps an answer that arrives after the writer's last safe step instead of accepting its early final reply", () => {
  const { questionId } = ask();
  work.briefing("writer", "work");
  answer(questionId);
  work.finishTurn(turn("writer"), "writer", "Old reply without the answer", false);
  expect(assignment("writer")).toMatchObject({ state: "submitted", result: null, waiting: true });
  work.queueQuestionTurns("work");
  expect(turn("writer")).toContain("peer:");
  expect(required(work.briefing("writer", "work")).instructions).toContain("explicitly allow");
});

it("delivers a question arriving as the recipient finishes and reports an unanswered question honestly", () => {
  work.briefing("researcher", "work");
  ask();
  work.finishTurn(turn("researcher"), "researcher", "Early result", false);
  expect(assignment("researcher").state).toBe("submitted");
  work.queueQuestionTurns("work");
  const resumed = turn("researcher");
  expect(required(work.briefing("researcher", "work")).instructions).toContain("question:");
  work.submitted(resumed);
  work.finishTurn(resumed, "researcher", "Finished without answering", false);
  expect(teamQuestions(work.get("work")?.updates)[0].response).toMatchObject({
    kind: "question_closed"
  });
  expect(assignment("researcher").state).toBe("returned");
});

it("prevents cross-task access, impersonated answers, key reuse, chains, and unbounded messages", () => {
  expect(work.peers("writer", "work").map((item) => item.botId)).toEqual(
    expect.arrayContaining(["researcher", "third"])
  );
  expect(() => ask("outside", "outsider")).toThrow("no active assignment");
  expect(() => ask("self", "writer")).toThrow("another specialist");
  const { questionId } = ask();
  expect(() => ask("eligibility", "third")).toThrow("key is already in use");
  expect(() => ask("another", "third")).toThrow("pending answer");
  expect(() => ask("chain", "third", "researcher")).toThrow("incoming questions first");
  expect(() => ask("cycle", "writer", "third")).toThrow("waiting for an answer");
  expect(() =>
    work.answer("third", "work", { action: "answer", questionId, answer: "Fake" })
  ).toThrow("not addressed");
  expect(() =>
    work.ask("writer", "other-task", {
      action: "ask",
      key: "cross",
      botId: "researcher",
      question: "Read private context"
    })
  ).toThrow("no longer active");
  expect(
    teamWorkInput.safeParse({
      action: "ask",
      key: "long",
      botId: "researcher",
      question: "x".repeat(2001)
    }).success
  ).toBe(false);
  expect(
    teamWorkInput.safeParse({ action: "answer", questionId, answer: "x".repeat(4001) }).success
  ).toBe(false);
  answer(questionId);
  expect(() => answer(questionId, "Changed answer")).toThrow("already has a saved answer");
});

it("caps questions per assignment and never reopens a completed recipient", () => {
  for (let index = 0; index < 3; index++) answer(ask(`q${index}`).questionId);
  expect(() => ask("fourth")).toThrow("question limit");
  work.finishTurn(turn("researcher"), "researcher", "Final source report", false);
  expect(work.peers("third", "work").some((item) => item.botId === "researcher")).toBe(false);
  expect(() => ask("late", "researcher", "third")).toThrow("no active assignment");
});

it("closes expired or stopped-peer questions and wakes the requester without polling", () => {
  ask();
  work.wait("writer", "work");
  work.finishTurn(turn("writer"), "writer", "Waiting", false);
  const future = Date.now() + QUESTION_TIMEOUT_MS + 1;
  vi.spyOn(Date, "now").mockReturnValue(future);
  work.queueQuestionTurns("work");
  expect(teamQuestions(work.get("work")?.updates)[0].response?.message).toContain("ten minutes");
  expect(turn("writer")).toContain("peer:");
});

it("keeps stopped work stopped and closes a question when its recipient loses access", () => {
  const { questionId } = ask();
  work.cancelBot("researcher");
  work.reconcileQuestions("work");
  expect(teamQuestions(work.get("work")?.updates)[0].response?.kind).toBe("question_closed");
  expect(() => answer(questionId)).toThrow("no active assignment");
  work.stop("work", "Owner stopped task");
  work.queueQuestionTurns("work");
  expect(work.pending()).toHaveLength(0);
  expect(() => ask("late")).toThrow("no longer active");
});

it("keeps peer exchanges visible to involved managers and respects the root budget", () => {
  const policies = new WorkspaceTeamPolicy(sql);
  policies.save("third", { ...policies.get("third"), canManage: true });
  const child = work.assign("third", "work", {
    action: "assign",
    key: "child",
    botId: "outsider",
    instruction: "Check wording",
    criterion: "Verified wording"
  });
  work.submitted(`assignment:${child.id}`);
  const question = ask("wording", "researcher", "outsider");
  answer(question.questionId);
  expect(teamQuestions(work.forBot("third", "work")?.updates)).toHaveLength(1);
  expect(
    work.forBot("third", "work")?.assignments.some((item) => item.botId === "researcher")
  ).toBe(false);
  expect(() =>
    work.ask("third", "work", {
      action: "ask",
      key: "manager",
      botId: "writer",
      question: "Delegate?"
    })
  ).toThrow("active specialists");
  sql`UPDATE team_work SET budget_usd = 0 WHERE id = 'work'`;
  expect(() => ask("over-budget", "writer", "researcher")).toThrow("budget");
});

it("does not let a manager-capable specialist finish before reading a pending answer", () => {
  const policies = new WorkspaceTeamPolicy(sql);
  policies.save("writer", { ...policies.get("writer"), canManage: true });
  const { questionId } = ask();
  const input = {
    action: "finish" as const,
    result: "Checked copy",
    checks: [{ criterion: 0, check: "Verified" }]
  };
  expect(() => work.finish("writer", "work", input)).toThrow("pending specialist questions");
  answer(questionId);
  expect(() => work.finish("writer", "work", input)).toThrow("pending specialist questions");
  work.briefing("writer", "work");
  expect(work.finish("writer", "work", input)).toMatchObject({ state: "completed" });
});

it("marks only complete briefing entries as delivered", () => {
  for (let index = 0; index < 8; index++) {
    sql`INSERT INTO team_updates (id, work_id, assignment_id, sender_bot_id, recipient_bot_id, kind, message, created_at) VALUES (${`large-${index}`}, 'work', ${assignment("researcher").id}, ${chief}, 'researcher', 'redirect', ${"x".repeat(3900)}, ${new Date().toISOString()})`;
  }
  const briefing = required(work.briefing("researcher", "work")).instructions;
  expect(briefing.length).toBeLessThan(15_000);
  const delivered = sql<{ id: string }>`SELECT id FROM team_updates WHERE delivered = 1`;
  expect(delivered.length).toBeGreaterThan(0);
  expect(delivered.length).toBeLessThan(8);
  for (const item of delivered) expect(briefing).toContain(item.id);
});
