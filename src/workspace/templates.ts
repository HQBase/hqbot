import { z } from "zod";
import { parseTemplate, type TeammateTemplate, type TemplateShare } from "../domain/templates";
import { WorkspaceCatalog } from "./catalog";
import { WorkspaceKnowledge } from "./knowledge";
import { WorkspaceRoutines } from "./routines";
import { now, type Row, type Sql, text } from "./sql";

export class WorkspaceTemplates {
  constructor(private readonly sql: Sql) {}
  export(botId: string, skillIds: string[], routineIds: string[]): TeammateTemplate {
    const catalog = new WorkspaceCatalog(this.sql);
    const bot = catalog.getBot(botId);
    if (!bot) throw new Error("Teammate not found");
    const skills = catalog.listSkills(botId).filter((item) => skillIds.includes(item.id));
    const routines = new WorkspaceRoutines(this.sql)
      .list(botId)
      .filter((item) => routineIds.includes(item.id));
    if (skills.length !== new Set(skillIds).size || routines.length !== new Set(routineIds).size)
      throw new Error("A selected resource is no longer available");
    return parseTemplate({
      format: "hqbot-teammate",
      version: 1,
      profile: {
        name: bot.name,
        title: bot.title,
        description: bot.description,
        brief: bot.brief,
        modelId: bot.modelId,
        dailyBudgetUsd: bot.dailyBudgetUsd,
        maxSteps: bot.maxSteps
      },
      skills: skills.map(({ name, description, instructions }) => ({
        name,
        description,
        instructions
      })),
      routines: routines.map(({ name, prompt, schedule }) => ({ name, prompt, schedule }))
    });
  }
  import(id: string, value: unknown) {
    z.uuid().parse(id);
    const template = parseTemplate(value);
    const encoded = JSON.stringify(template);
    const prior = this.sql<Row>`SELECT * FROM template_imports WHERE id = ${id}`[0];
    const catalog = new WorkspaceCatalog(this.sql);
    if (prior) {
      const bot = catalog.getBot(text(prior, "bot_id"));
      if (!bot) throw new Error("The imported teammate was deleted. Start a new import.");
      if (prior.template_json !== encoded) throw new Error("Import ID is already in use");
      return bot;
    }
    const bot = catalog.createBot(
      crypto.randomUUID(),
      template.profile,
      template.profile.brief,
      template.profile.modelId,
      template.profile.dailyBudgetUsd
    );
    catalog.updateBot(bot.id, { maxSteps: template.profile.maxSteps });
    const knowledge = new WorkspaceKnowledge(this.sql);
    template.skills.forEach((skill, index) => {
      knowledge.save(bot.id, `template:${id}:${index}`, {
        ...skill,
        kind: "skill",
        status: "draft",
        source: "Imported template. Review and test before use."
      });
    });
    const routines = new WorkspaceRoutines(this.sql);
    template.routines.forEach((routine) => {
      routines.save({ ...routine, botId: bot.id, active: false });
    });
    this
      .sql`INSERT INTO template_imports (id, bot_id, template_json, created_at) VALUES (${id}, ${bot.id}, ${encoded}, ${now()})`;
    return catalog.getBot(bot.id);
  }
  publish(id: string, value: unknown): TemplateShare {
    z.uuid().parse(id);
    const template = parseTemplate(value);
    const encoded = JSON.stringify(template);
    const prior = this.sql<Row>`SELECT * FROM template_shares WHERE id = ${id}`[0];
    if (prior) {
      if (prior.template_json !== encoded || prior.revoked_at)
        throw new Error("Share ID is already in use");
      return this.share(prior);
    }
    if (
      this.sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM template_shares WHERE revoked_at IS NULL`[0]?.count >= 50
    )
      throw new Error("Revoke an old link before publishing another template");
    this
      .sql`INSERT INTO template_shares (id, name, template_json, created_at) VALUES (${id}, ${template.profile.name}, ${encoded}, ${now()})`;
    return this.list().find((item) => item.id === id) as TemplateShare;
  }
  private share(row: Row): TemplateShare {
    return {
      id: text(row, "id"),
      name: text(row, "name"),
      createdAt: text(row, "created_at"),
      revokedAt: row.revoked_at ? text(row, "revoked_at") : null
    };
  }
  list() {
    return this
      .sql<Row>`SELECT id,name,created_at,revoked_at FROM template_shares WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 50`.map(
      (row) => this.share(row)
    );
  }
  revoke(id: string) {
    this
      .sql`UPDATE template_shares SET revoked_at = ${now()}, template_json = '{}' WHERE id = ${id} AND revoked_at IS NULL`;
  }
  published(id: string): TeammateTemplate | null {
    const row = this
      .sql<Row>`SELECT template_json FROM template_shares WHERE id = ${id} AND revoked_at IS NULL`[0];
    return row ? parseTemplate(JSON.parse(text(row, "template_json"))) : null;
  }
}
