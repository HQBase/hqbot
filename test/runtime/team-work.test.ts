import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { ensureChief } from "../../src/workspace/chief";
import { migrateWorkspace } from "../../src/workspace/migrations";
import { reserveModelRequest } from "../../src/workspace/model-budget";
import { WorkspaceProjects } from "../../src/workspace/projects";
import type { Sql, SqlValue } from "../../src/workspace/sql";
import { WorkspaceTasks } from "../../src/workspace/tasks";
import { WorkspaceTeamPolicy } from "../../src/workspace/team-policy";
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
it("enforces one owner, stable assignments, manager permission and reviewed completion", () => {
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
  ).toThrow("existing team task");
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
  work.ownerReturned("work", chief, false);
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

it("does not resume an owner until its response is saved, and ignores an old callback", () => {
  start();
  assign();
  work.wait(chief, "work");
  work.finishTurn("assignment:work:source", "one", "Checked source", false);
  work.queueOwner("work");
  expect(work.pending()).toEqual([]);
  work.ownerReturned("work", chief, false);
  work.ownerReturned("work", chief, false);
  expect(work.pending().map((item) => item.id)).toEqual(["owner:work:1"]);
  work.submitted("owner:work:1");
  work.finishTurn("owner:work:1", chief, "Needs more work", false);
  expect(work.pending().map((item) => item.id)).toEqual(["owner:work:2"]);
  work.ownerReturned("work", chief, true, "owner:work:1");
  expect(work.get("work")?.state).toBe("active");
});
it("rejects a replay with changed limits or changed completion evidence", () => {
  start();
  expect(() =>
    work.start(
      chief,
      "work",
      {
        action: "start",
        goal: "Compare sources",
        criteria: ["Both sources checked"],
        budgetUsd: 0.2
      },
      1
    )
  ).toThrow("already in use");
  finish();
  expect(() =>
    work.finish(chief, "work", {
      action: "finish",
      result: "Checked sources",
      checks: [{ criterion: 0, check: "Different evidence" }]
    })
  ).toThrow("different saved");
  expect(work.pending()).toEqual([]);
});

function enableManager(botId = "one", maxConcurrent = 6) {
  const policy = new WorkspaceTeamPolicy(sql);
  policy.save(botId, { ...policy.get(botId), canManage: true, maxConcurrent });
}
function child(botId = "two", managerId = "one", key = "child") {
  return work.assign(managerId, "work", {
    action: "assign",
    key,
    botId,
    instruction: `Research ${botId}`,
    criterion: "Cited source"
  });
}
it("resumes a nested manager once, reviews each handoff, and preserves one root budget", () => {
  start();
  enableManager();
  const parent = assign();
  work.submitted(`assignment:${parent.id}`);
  const nested = child();
  expect(nested).toMatchObject({
    parentId: parent.id,
    managerBotId: "one",
    depth: 2,
    workId: "work",
    modelId: "test"
  });
  expect(work.forBot("two", "work")?.assignments.map((item) => item.id)).toEqual([nested.id]);
  expect(work.forBot("one", "work")?.assignments).toHaveLength(2);
  work.wait("one", "work");
  work.wait(chief, "work");
  work.ownerReturned("work", chief, false);
  work.finishTurn(`assignment:${parent.id}`, "one", "Waiting for research", false);
  expect(work.get("work")?.assignments.find((item) => item.id === parent.id)?.state).toBe(
    "submitted"
  );
  work.finishTurn(`assignment:${nested.id}`, "two", "Source checked", false);
  work = new TeamWorkDelivery(sql);
  work.queueManagers("work");
  work.queueManagers("work");
  work.queueOwner("work");
  expect(work.pending().map((item) => item.id)).toEqual([`manager:${parent.id}:1`]);
  expect(() =>
    work.review(chief, "work", {
      action: "review",
      assignmentId: nested.id,
      check: "Root skips manager",
      accepted: true
    })
  ).toThrow("no returned result");
  work.review("one", "work", {
    action: "review",
    assignmentId: nested.id,
    check: "Opened source",
    accepted: true
  });
  const complete = {
    action: "finish" as const,
    result: "Checked evidence",
    checks: [{ criterion: 0, check: "Source verified" }]
  };
  expect(work.finish("one", "work", complete)).toMatchObject({ state: "completed" });
  expect(() => work.finish("one", "work", { ...complete, result: "Changed result" })).toThrow(
    "different saved result"
  );
  work.finishTurn(`manager:${parent.id}:1`, "one", "A short final reply", false);
  expect(work.get("work")?.assignments.find((item) => item.id === parent.id)?.result).toBe(
    "Checked evidence"
  );
  work.queueOwner("work");
  expect(work.pending().map((item) => item.id)).toEqual(["owner:work:1"]);
  work.review(chief, "work", {
    action: "review",
    assignmentId: parent.id,
    check: "Checked manager evidence",
    accepted: true
  });
  expect(finish()?.state).toBe("completed");
});
it("allows handoff at a one-branch limit and blocks extra branches and deeper chains", () => {
  start();
  enableManager();
  enableManager(chief, 1);
  enableManager("two");
  enableManager("outside");
  assign();
  const nested = child();
  expect(nested.depth).toBe(2);
  expect(() => child("outside", "one", "extra")).toThrow("Wait for");
  expect(() => child("outside", "two", "third")).toThrow("depth limit");
  expect(() => child(chief, "two", "cycle")).toThrow("another active teammate");
});
it("enforces allowed models without changing the employee default and applies revocation", () => {
  start();
  enableManager();
  const policies = new WorkspaceTeamPolicy(sql);
  policies.save(chief, { ...policies.get(chief), allowedModelIds: ["test", "alternate"] });
  expect(() =>
    work.assign(chief, "work", {
      action: "assign",
      key: "bad",
      botId: "one",
      instruction: "Check",
      criterion: "done",
      modelId: "unapproved"
    })
  ).toThrow("allowed");
  const parent = work.assign(chief, "work", {
    action: "assign",
    key: "manager",
    botId: "one",
    instruction: "Research",
    criterion: "done",
    modelId: "alternate"
  });
  expect(work.turn(`assignment:${parent.id}`, "one")?.modelId).toBe("alternate");
  expect(catalog.getBot("one")?.modelId).toBe("test");
  const nested = child();
  policies.save("one", { ...policies.get("one"), canManage: false });
  expect(() => work.assertAllowed("work", "two")).toThrow("parent manager");
  expect(work.turn(`assignment:${nested.id}`, "two")).toBeNull();
  enableManager();
  policies.save(chief, { ...policies.get(chief), allowedModelIds: ["test"] });
  expect(() => work.assertAllowed("work", "one")).toThrow("model is no longer allowed");
});
it("stops all descendants when a manager fails and does not affect another branch", () => {
  start();
  enableManager();
  const parent = assign();
  const nested = child();
  assign("outside", "separate");
  work.finishTurn(`assignment:${parent.id}`, "one", "Stopped manager", true);
  expect(work.get("work")?.assignments.find((item) => item.id === nested.id)?.state).toBe(
    "cancelled"
  );
  expect(work.get("work")?.assignments.find((item) => item.botId === "outside")?.state).toBe(
    "queued"
  );
  expect(work.cancellations()).toContainEqual({ work_id: "work", bot_id: "two" });
  work.cancelBot(chief);
  expect(work.pending()).toHaveLength(0);
  work.finishTurn(`assignment:${nested.id}`, "two", "Late result", false);
  expect(work.get("work")?.assignments.find((item) => item.id === nested.id)?.result).toBeNull();
});
it("saves check-ins across restarts and acknowledges only guidance the teammate has read", () => {
  start();
  const assignment = assign();
  const input = {
    action: "check_in" as const,
    assignmentId: assignment.id,
    key: "check",
    message: "Give progress and the next step"
  };
  work.requestUpdate(chief, "work", input);
  work.requestUpdate(chief, "work", input);
  expect(work.get("work")?.updates).toHaveLength(1);
  work.report("one", "work", "before-reading", {
    action: "report",
    summary: "Started",
    nextStep: "Read source",
    blocked: false
  });
  expect(work.get("work")?.updates?.find((item) => item.kind === "check_in")?.acknowledged).toBe(
    false
  );
  work = new TeamWorkDelivery(sql);
  expect(work.briefing("one", "work")?.instructions).toContain(input.message);
  work.report("one", "work", "after-reading", {
    action: "report",
    summary: "Source opened",
    nextStep: "Check evidence",
    blocked: false
  });
  expect(work.get("work")?.updates?.find((item) => item.kind === "check_in")?.acknowledged).toBe(
    true
  );
  expect(work.briefing("one", "work")?.instructions).toBe("");
  expect(() => work.requestUpdate("outside", "work", input)).toThrow("no active assignment");
});
it("wakes a waiting manager for a blocker without duplicating its turn", () => {
  start();
  assign();
  work.wait(chief, "work");
  work.ownerReturned("work", chief, false);
  work.report("one", "work", "blocker", {
    action: "report",
    summary: "Source requires access",
    nextStep: "Use a public source",
    blocked: true
  });
  work.queueOwner("work");
  work.queueOwner("work");
  expect(work.pending().filter((item) => item.bot_id === chief)).toHaveLength(1);
  expect(work.briefing(chief, "work")?.instructions).toContain("Source requires access");
});
it("requires explicit hiring permission, deduplicates hires and never copies private resources", () => {
  const policies = new WorkspaceTeamPolicy(sql);
  const input = {
    action: "hire" as const,
    key: "researcher",
    name: "Researcher",
    role: "Check sources",
    manager: false
  };
  expect(() => policies.hire(chief, input)).toThrow("enable creating");
  policies.save(chief, { ...policies.get(chief), canCreate: true, maxEmployees: 1 });
  const hired = policies.hire(chief, input);
  expect(policies.hire(chief, input).id).toBe(hired.id);
  expect(policies.get(hired.id)).toMatchObject({
    canManage: false,
    canCreate: false,
    canCreateManagers: false
  });
  expect(catalog.listMemories(hired.id)).toEqual([]);
  expect(() => policies.hire(chief, { ...input, role: "Changed role" })).toThrow(
    "key is already in use"
  );
  expect(() => policies.hire(chief, { ...input, key: "second" })).toThrow("employee limit");
  expect(() => policies.hire(chief, { ...input, key: "manager", manager: true })).toThrow(
    "create managers"
  );
  sql`DELETE FROM bots WHERE id = ${hired.id}`;
  expect(() => policies.hire(chief, input)).toThrow("removed or archived");
});
it("enforces actual fallback models and the daily budget across separate root tasks", () => {
  start();
  assign();
  const policies = new WorkspaceTeamPolicy(sql);
  policies.save(chief, { ...policies.get(chief), dailyBudgetUsd: 0.1 });
  const reserve = (eventId: string, modelId: string, amount: number) =>
    reserveModelRequest(sql, {} as never, catalog, new WorkspaceTasks(sql), {
      eventId,
      botId: "one",
      taskId: null,
      teamWorkId: "work",
      unpriced: false,
      modelId,
      inputTokens: 100,
      outputTokens: 100,
      estimatedCostMicroUsd: amount * 1000000
    });
  expect(() => reserve("fallback", "other", 0.01)).toThrow("fallback is not allowed");
  reserve("first", "test", 0.06);
  work.stop("work", "End first task");
  work.start(
    chief,
    "next",
    { action: "start", goal: "Next task", criteria: ["Done"], budgetUsd: 0.1 },
    1
  );
  expect(() => work.assertAllowed("next", chief, 0.05)).toThrow("daily team model budget");
});
