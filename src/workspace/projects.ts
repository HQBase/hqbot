import { type Project, projectInput } from "../domain/projects";
import { WorkspaceCatalog } from "./catalog";
import { WorkspaceKnowledge } from "./knowledge";
import { now, type Row, type Sql, text } from "./sql";

export class WorkspaceProjects {
  protected readonly catalog: WorkspaceCatalog;
  constructor(protected readonly sql: Sql) {
    this.catalog = new WorkspaceCatalog(sql);
  }
  list(botId?: string): Project[] {
    const rows = botId
      ? this
          .sql<Row>`SELECT p.* FROM projects p JOIN project_teammates m ON p.id = m.project_id WHERE m.bot_id = ${botId} ORDER BY p.updated_at DESC`
      : this.sql<Row>`SELECT * FROM projects ORDER BY updated_at DESC`;
    return rows.map((row) => ({
      id: text(row, "id"),
      name: text(row, "name"),
      description: text(row, "description"),
      revision: Number(row.revision),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
      botIds: this.sql<{
        bot_id: string;
      }>`SELECT bot_id FROM project_teammates WHERE project_id = ${text(row, "id")}`.map(
        (item) => item.bot_id
      ),
      resources: this.sql<{
        kind: "file" | "skill";
        item_id: string;
        bot_id: string;
      }>`SELECT kind, item_id, bot_id FROM project_resources WHERE project_id = ${text(row, "id")}`.map(
        (item) => ({ kind: item.kind, id: item.item_id, botId: item.bot_id })
      )
    }));
  }
  save(value: unknown): Project {
    const input = projectInput.parse(value);
    const current = input.id ? this.list().find((item) => item.id === input.id) : null;
    if (input.id && !current) throw new Error("Project not found");
    if (current && input.revision !== current.revision)
      throw new Error("The project changed. Refresh before saving.");
    if (new Set(input.botIds).size !== input.botIds.length)
      throw new Error("Choose each teammate once");
    for (const id of input.botIds) {
      const bot = this.catalog.getBot(id);
      if (!bot || bot.hidden) throw new Error("Choose active teammates");
    }
    for (const resource of input.resources) {
      if (!input.botIds.includes(resource.botId))
        throw new Error("Shared resources must belong to a project teammate");
      const exists =
        resource.kind === "file"
          ? this.catalog.getFile(resource.id, resource.botId)
          : this.catalog.listSkills(resource.botId).find((skill) => skill.id === resource.id);
      if (!exists) throw new Error("Shared resource not found");
    }
    const id = current?.id ?? crypto.randomUUID();
    const stamp = now();
    this
      .sql`INSERT INTO projects (id, name, description, revision, created_at, updated_at) VALUES (${id}, ${input.name}, ${input.description}, 1, ${stamp}, ${stamp}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, revision = projects.revision + 1, updated_at = excluded.updated_at`;
    this.sql`DELETE FROM project_teammates WHERE project_id = ${id}`;
    this.sql`DELETE FROM project_resources WHERE project_id = ${id}`;
    for (const botId of input.botIds)
      this.sql`INSERT INTO project_teammates (project_id, bot_id) VALUES (${id}, ${botId})`;
    for (const resource of input.resources)
      this
        .sql`INSERT OR IGNORE INTO project_resources (project_id, kind, item_id, bot_id) VALUES (${id}, ${resource.kind}, ${resource.id}, ${resource.botId})`;
    this
      .sql`UPDATE collaboration_deliveries SET state = 'cancelled', updated_at = ${stamp} WHERE project_id = ${id} AND state IN ('pending', 'submitted') AND bot_id NOT IN (SELECT bot_id FROM project_teammates WHERE project_id = ${id})`;
    const saved = this.list().find((item) => item.id === id);
    if (!saved) throw new Error("Project could not be saved");
    return saved;
  }
  assertMember(projectId: string, botId?: string): Project {
    const project = this.list(botId).find((item) => item.id === projectId);
    if (!project) throw new Error("Project not found or access removed");
    return project;
  }
  resources(projectId: string, botId: string) {
    const project = this.assertMember(projectId, botId);
    const files = project.resources.flatMap((item) =>
      item.kind === "file" ? (this.catalog.getFile(item.id, item.botId) ?? []) : []
    );
    const skills = project.resources.flatMap((item) =>
      item.kind === "skill"
        ? new WorkspaceKnowledge(this.sql)
            .list(item.botId)
            .filter((skill) => skill.kind === "skill")
            .filter((skill) => skill.id === item.id && skill.status === "ready")
        : []
    );
    return { files, skills };
  }
}
