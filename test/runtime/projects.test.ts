import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceCatalog } from "../../src/workspace/catalog";
import { WorkspaceCollaboration } from "../../src/workspace/collaboration";
import { migrateWorkspace } from "../../src/workspace/migrations";
import type { Sql, SqlValue } from "../../src/workspace/sql";

let db: DatabaseSync;
let projects: WorkspaceCollaboration;
let catalog: WorkspaceCatalog;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const sql = ((parts: TemplateStringsArray, ...values: SqlValue[]) =>
    db
      .prepare(parts.join("?"))
      .all(...values.map((value) => (typeof value === "boolean" ? Number(value) : value)))) as Sql;
  migrateWorkspace(sql);
  catalog = new WorkspaceCatalog(sql);
  projects = new WorkspaceCollaboration(sql);
  for (const id of ["one", "two", "outside"])
    catalog.createBot(id, { name: id, title: id, description: id }, id, "test", 2);
});
afterEach(() => db.close());
it("shares only selected resources with project members and revokes access on edit", () => {
  catalog.createFile({
    id: "file",
    botId: "one",
    name: "report.txt",
    key: "private/report",
    contentType: "text/plain",
    size: 5
  });
  const project = projects.save({
    name: "Research",
    botIds: ["one", "two"],
    resources: [{ id: "file", botId: "one", kind: "file" }]
  });
  expect(projects.resources(project.id, "two").files[0]?.id).toBe("file");
  expect(() => projects.resources(project.id, "outside")).toThrow("access removed");
  projects.save({ ...project, botIds: ["one"] });
  expect(() => projects.resources(project.id, "two")).toThrow("access removed");
  expect(() => projects.save(project)).toThrow("changed");
});
it("deduplicates deliveries and rejects forged project and reply targets", () => {
  const project = projects.save({ name: "Research", botIds: ["one", "two"] });
  const input = {
    id: "request",
    projectId: project.id,
    content: "Compare the sources",
    recipientIds: ["one", "two"]
  };
  expect(projects.send(null, input).id).toBe("request");
  projects.send(null, input);
  expect(projects.pending()).toHaveLength(2);
  expect(() => projects.send(null, { ...input, content: "Different request" })).toThrow(
    "already in use"
  );
  expect(() => projects.send("outside", { ...input, id: "outside" })).toThrow("access removed");
  expect(() => projects.send(null, { ...input, id: "fake", parentId: "unknown" })).toThrow(
    "Thread not found"
  );
  expect(projects.delivery("request:one", "two")).toBeNull();
});
it("returns a handoff result once without creating a reply loop", () => {
  const project = projects.save({ name: "Research", botIds: ["one", "two"] });
  projects.send("one", {
    id: "handoff",
    projectId: project.id,
    content: "Check this",
    recipientIds: ["two"]
  });
  projects.finish("handoff:two", "two", "Checked");
  projects.finish("handoff:two", "two", "Duplicate");
  expect(projects.pending()).toHaveLength(1);
  const returned = projects.delivery("return:handoff:two", "one");
  expect(returned).toMatchObject({ response: true, depth: 1, prompt: "Checked" });
  projects.finish("return:handoff:two", "one", "Thanks. Final report saved.");
  expect(projects.pending()).toHaveLength(0);
  expect(projects.messages(project.id)).toHaveLength(3);
});
it("enforces handoff depth and cancels queued work when a teammate stops", () => {
  const project = projects.save({ name: "Research", botIds: ["one", "two"] });
  projects.send(null, {
    id: "root",
    projectId: project.id,
    content: "Start",
    recipientIds: ["one"]
  });
  let parent = "root:one";
  let sender = "one";
  for (let depth = 1; depth <= 4; depth++) {
    const recipient = sender === "one" ? "two" : "one";
    projects.send(sender, {
      id: `hop-${depth}`,
      projectId: project.id,
      content: "Check",
      recipientIds: [recipient],
      parentDeliveryId: parent
    });
    parent = `hop-${depth}:${recipient}`;
    sender = recipient;
  }
  expect(() =>
    projects.send(sender, {
      id: "too-deep",
      projectId: project.id,
      content: "Again",
      recipientIds: [sender === "one" ? "two" : "one"],
      parentDeliveryId: parent
    })
  ).toThrow("handoff limit");
  projects.cancelBot("one");
  expect(projects.pending()).toHaveLength(0);
});
it("removes group data with a project and keeps its teammates", () => {
  const project = projects.save({ name: "Research", botIds: ["one", "two"] });
  projects.send(null, {
    id: "root",
    projectId: project.id,
    content: "Start",
    recipientIds: ["one"]
  });
  projects.remove(project.id);
  expect(projects.pending()).toEqual([]);
  expect(db.prepare("SELECT COUNT(*) AS count FROM project_messages").get()).toEqual({ count: 0 });
  expect(catalog.listBots()).toHaveLength(3);
});
