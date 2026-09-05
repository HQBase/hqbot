import {
  type PermissionDecision,
  type PermissionRule,
  permissionRuleInput,
  resolvePermission
} from "../domain/permissions";
import type { Sql } from "../workspace/sql";

export function migratePermissionRules(sql: Sql): void {
  sql`CREATE TABLE IF NOT EXISTS hqbot_permission_rules (id TEXT PRIMARY KEY, rule_json TEXT NOT NULL, created_at TEXT NOT NULL)`;
}
export class PermissionRules {
  constructor(
    private readonly sql: Sql,
    private readonly taskId: () => string | null = () => null
  ) {}
  list(): PermissionRule[] {
    return this.sql<{
      rule_json: string;
    }>`SELECT rule_json FROM hqbot_permission_rules ORDER BY created_at DESC, id`.map(
      (row) => JSON.parse(row.rule_json) as PermissionRule
    );
  }
  save(value: unknown): PermissionRule {
    const parsed = permissionRuleInput.parse(value);
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now())
      throw new Error("Choose a future expiry time");
    const rules = this.list();
    if (rules.length >= 200 && !parsed.id)
      throw new Error("Remove an unused rule before adding another");
    const previous = parsed.id ? rules.find((rule) => rule.id === parsed.id) : null;
    if (parsed.id && !previous) throw new Error("Permission rule not found");
    const rule = {
      ...parsed,
      id: parsed.id ?? crypto.randomUUID(),
      createdAt: previous?.createdAt ?? new Date().toISOString()
    };
    this
      .sql`INSERT INTO hqbot_permission_rules (id, rule_json, created_at) VALUES (${rule.id}, ${JSON.stringify(rule)}, ${rule.createdAt}) ON CONFLICT(id) DO UPDATE SET rule_json = excluded.rule_json`;
    return rule;
  }
  remove(id: string): boolean {
    return this.sql`DELETE FROM hqbot_permission_rules WHERE id = ${id} RETURNING id`.length > 0;
  }
  decide(
    connector: string,
    action: string,
    input: unknown,
    fallback: PermissionDecision = "review"
  ): PermissionDecision {
    return resolvePermission(this.list(), connector, action, input, this.taskId(), fallback);
  }
}
