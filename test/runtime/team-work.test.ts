import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { ensureChief } from "../../src/workspace/chief";
import { migrateWorkspace } from "../../src/workspace/migrations";
import { reserveModelRequest } from "../../src/workspace/model-budget";
import { WorkspaceProjects } from "../../src/workspace/projects";
import type { Sql, SqlValue } from "../../src/workspace/sql";
import { WorkspaceTasks } from "../../src/workspace/tasks";
import { TeamWorkDelivery } from "../../src/workspace/team-work-delivery";

let db: DatabaseSync;
let sql: Sql;
let work: TeamWorkDelivery;
let catalog: WorkspaceCatalog;
let chief: string;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateWorkspace(sql);
  catalog = new WorkspaceCatalog(sql);
  for (const id of ["one", "two", "outside"])
    catalog.createBot(id, { name: id, title: id, description: id }, id, "test", 2);
  chief = ensureChief(sql, "test", 2)?.id ?? "missing";
  work = new TeamWorkDelivery(sql);
});
afterEach(() => db.close());
const start = () =>
  work.start(
    chief,
    "work",
    {
      action: "start",
      goal: "Compare sources",
      criteria: ["Both sources checked"],
      budgetUsd: 0.1
    },
    1
  );
const assign = (botId = "one", key = "source") =>
  work.assign(chief, "work", {
    action: "assign",
    key,
    botId,
    instruction: `Check ${botId}`,
    criterion: "Cited source"
  });
const finish = () =>
  work.finish(chief, "work", {
    action: "finish",
    result: "Checked sources",
    checks: [{ criterion: 0, check: "Compared the cited source" }]
  });

it("creates one pinned Chief and preserves existing teammates", () => {
  expect(ensureChief(sql, "test", 2)?.id).toBe(chief);
  expect(catalog.listBots()[0]).toMatchObject({
    id: chief,
    pinned: true,
    coordinationRole: "chief"
  });
  expect(catalog.listBots()).toHaveLength(4);
});
it("enforces one owner, stable assignments, leaf work and reviewed completion", () => {
  start();
  expect(() =>
    work.start(chief, "another", { action: "start", goal: "Duplicate", criteria: ["done"] }, 1)
  ).toThrow("current team task");
  const item = assign();
  expect(assign()?.id).toBe(item?.id);
  expect(work.pending()).toHaveLength(1);
  expect(() =>
    work.assign("one", "work", {
      action: "assign",
      key: "recursive",
      botId: "two",
      instruction: "Do my task",
      criterion: "done"
    })
  ).toThrow("Only the task owner");
  expect(() => finish()).toThrow("Review every");
  work.submitted("assignment:work:source");
  expect(() =>
    work.start("one", "recursive", { action: "start", goal: "Subteam", criteria: ["done"] }, 1)
  ).toThrow("Specialists cannot delegate");
  work.finishTurn(
    "assignment:work:source",
    "one",
    "Source https://example.com supports the result",
    false
  );
  expect(() => finish()).toThrow("Review every");
  work.review(chief, "work", {
    action: "review",
    assignmentId: item?.id ?? "",
    accepted: true,
    check: "Opened the cited source and checked the result"
  });
  expect(finish()?.state).toBe("completed");
  expect(finish()?.state).toBe("completed");
});
it("requires a reviewed replacement for each rejected result", () => {
  start();
  assign();
  work.finishTurn("assignment:work:source", "one", "Missing source", true);
  work.review(chief, "work", {
    action: "review",
    assignmentId: "work:source",
    accepted: false,
    check: "No usable evidence"
  });
  assign("two", "replacement");
  work.finishTurn("assignment:work:replacement", "two", "Checked source", false);
  expect(() => finish()).toThrow("Review every");
  work.review(chief, "work", {
    action: "review",
    assignmentId: "work:replacement",
    accepted: true,
    check: "Verified source"
  });
  expect(finish()?.state).toBe("completed");
});
it("waits for all specialists and resumes one owner after a restart", () => {
  start();
  assign();
  assign("two", "other");
  work.wait(chief, "work");
  work.finishTurn("assignment:work:source", "one", "Source one", false);
  work.queueOwner("work");
  expect(work.pending().map((item) => item.id)).toEqual(["assignment:work:other"]);
  work = new TeamWorkDelivery(sql);
  work.finishTurn("assignment:work:other", "two", "Source two", false);
  work.queueOwner("work");
  work.queueOwner("work");
  expect(work.pending().map((item) => item.id)).toEqual(["owner:work:1"]);
  expect(work.turn("owner:work:1", chief)?.prompt).toContain("Review every result");
  expect(work.forBot("one", "work")?.assignments).toHaveLength(1);
  expect(work.forBot("outside", "work")).toBeNull();
});
it("counts model reservations for the whole team and rejects unknown prices", () => {
  start();
  assign();
  assign("two", "other");
  const reserve = (eventId: string, botId: string, amount: number, unpriced = false) =>
    reserveModelRequest(sql, {} as never, catalog, new WorkspaceTasks(sql), {
      eventId,
      botId,
      taskId: null,
      teamWorkId: "work",
      inputTokens: 100,
      outputTokens: 100,
      estimatedCostMicroUsd: amount * 1_000_000,
      unpriced
    });
  reserve("first", "one", 0.06);
  reserve("first", "one", 0.06);
  expect(() => reserve("second", "two", 0.05)).toThrow("budget");
  expect(() => reserve("unknown", "two", 0, true)).toThrow("known prices");
  expect(work.get("work")?.spentUsd).toBe(0.06);
});
it("stops pending work at the deadline and ignores late results", () => {
  start();
  assign();
  work.submitted("assignment:work:source");
  sql`UPDATE team_work SET deadline_at = '2000-01-01T00:00:00Z' WHERE id = 'work'`;
  expect(() => work.assertAllowed("work", "one")).toThrow("deadline");
  work.stop("work", "Deadline reached", "failed");
  work.finishTurn("assignment:work:source", "one", "Late answer", false);
  expect(work.get("work")).toMatchObject({ state: "failed", result: "Deadline reached" });
  expect(work.get("work")?.assignments[0]).toMatchObject({ state: "cancelled", result: null });
  expect(work.pending()).toHaveLength(0);
  expect(
    work
      .cancellations()
      .map((item) => item.bot_id)
      .sort()
  ).toEqual([chief, "one"].sort());
});
it("cancels the entire team when its owner stops", () => {
  start();
  assign();
  assign("two", "other");
  work.cancelBot(chief);
  expect(work.get("work")?.state).toBe("cancelled");
  expect(work.pending()).toEqual([]);
  expect(() => work.assertAllowed("work", "two")).toThrow("no longer active");
});
it("requires the group lead and current membership", () => {
  const projects = new WorkspaceProjects(sql);
  const project = projects.save({ name: "Team", botIds: ["one", "two"], leadBotId: "one" });
  expect(() => projects.save({ ...project, leadBotId: "outside" })).toThrow("must be a member");
  expect(() =>
    work.start(
      "two",
      "work",
      { action: "start", projectId: project.id, goal: "Team", criteria: ["Checked"] },
      1
    )
  ).toThrow("Only the group lead");
  work.start(
    "one",
    "work",
    { action: "start", projectId: project.id, goal: "Team", criteria: ["Checked"] },
    1
  );
  work.assign("one", "work", {
    action: "assign",
    key: "check",
    botId: "two",
    instruction: "Check",
    criterion: "Cited evidence"
  });
  projects.save({ ...project, botIds: ["one"] });
  expect(() => work.assertAllowed("work", "two")).toThrow("access removed");
  expect(work.forBot("two", "work")).toBeNull();
});
