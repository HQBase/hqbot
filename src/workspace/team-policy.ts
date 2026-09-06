import { GLM_PRIMARY_MODEL_ID, HQBOT_MODELS } from "../domain/models";
import { type TeamPolicy, teamPolicyInput } from "../domain/team-policy";
import type { TeamWorkInput } from "../domain/team-work";
import { WorkspaceCatalog } from "./catalog";
import { now, type Row, type Sql, text } from "./sql";

export class WorkspaceTeamPolicy {
  private readonly catalog: WorkspaceCatalog;
  constructor(private readonly sql: Sql) {
    this.catalog = new WorkspaceCatalog(sql);
  }

  get(botId: string): TeamPolicy {
    const bot = this.catalog.getBot(botId);
    if (!bot) throw new Error("Teammate not found");
    const saved = this.sql<Row>`SELECT policy_json FROM team_policies WHERE bot_id = ${botId}`[0];
    if (saved) return teamPolicyInput.parse(JSON.parse(text(saved, "policy_json")));
    const modelId = HQBOT_MODELS.some((model) => model.id === bot.modelId && !model.rates)
      ? GLM_PRIMARY_MODEL_ID
      : (bot.modelId ?? GLM_PRIMARY_MODEL_ID);
    return {
      canManage: bot.coordinationRole === "chief",
      canCreate: false,
      canCreateManagers: false,
      allowedModelIds: [modelId],
      defaultModelId: modelId,
      maxEmployees: 8,
      maxConcurrent: 6,
      dailyBudgetUsd: bot.dailyBudgetUsd
    };
  }

  save(botId: string, value: TeamPolicy) {
    this.get(botId);
    const policy = teamPolicyInput.parse(value);
    this
      .sql`INSERT INTO team_policies (bot_id, policy_json) VALUES (${botId}, ${JSON.stringify(policy)}) ON CONFLICT(bot_id) DO UPDATE SET policy_json = excluded.policy_json`;
    return policy;
  }

  hire(botId: string, input: Extract<TeamWorkInput, { action: "hire" }>) {
    const policy = this.get(botId);
    if (!policy.canManage || !policy.canCreate || this.catalog.getBot(botId)?.hidden)
      throw new Error("The owner must enable creating teammates in Team management first");
    if (input.manager && !policy.canCreateManagers)
      throw new Error("The owner has not allowed this teammate to create managers");
    const id = `${botId}:${input.key}`;
    const serialized = JSON.stringify(input);
    const previous = this.sql<Row>`SELECT * FROM team_hires WHERE id = ${id}`[0];
    if (previous) {
      if (previous.input_json !== serialized) throw new Error("This hiring key is already in use");
      const bot = previous.bot_id && this.catalog.getBot(String(previous.bot_id));
      if (!bot || bot.hidden)
        throw new Error("This employee was removed or archived. Use a new key for a new employee.");
      return bot;
    }
    const count = this
      .sql<Row>`SELECT COUNT(*) AS count FROM team_hires h JOIN bots b ON b.id = h.bot_id WHERE h.creator_id = ${botId} AND b.hidden = 0`[0];
    if (Number(count?.count) >= policy.maxEmployees)
      throw new Error("The employee limit was reached");
    const modelId = input.modelId ?? policy.defaultModelId;
    if (!policy.allowedModelIds.includes(modelId))
      throw new Error("Choose a model allowed by the owner in Team management");
    const employeeId = crypto.randomUUID();
    const employee = this.catalog.createBot(
      employeeId,
      { name: input.name, title: input.name, description: input.role },
      input.role,
      modelId,
      Math.min(policy.dailyBudgetUsd, this.catalog.getBot(botId)?.dailyBudgetUsd ?? 2)
    );
    this
      .sql`INSERT INTO team_hires (id, creator_id, bot_id, input_json, created_at) VALUES (${id}, ${botId}, ${employeeId}, ${serialized}, ${now()})`;
    this.save(employeeId, {
      ...policy,
      canManage: Boolean(input.manager),
      canCreate: false,
      canCreateManagers: false,
      defaultModelId: modelId
    });
    return employee;
  }
}
