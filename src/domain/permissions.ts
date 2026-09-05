import { z } from "zod";

export interface PermissionRuleInput {
  id?: string;
  label: string;
  connector: string;
  action: string;
  decision: "allow" | "review" | "deny";
  scope:
    | { kind: "any" }
    | { kind: "exact"; value: unknown }
    | { kind: "field"; path: string[]; value: string | boolean | number }
    | { kind: "origin"; field: string; origin: string };
  taskId: string | null;
  expiresAt: string | null;
}
export const permissionRuleInput: z.ZodType<PermissionRuleInput> = z
  .object({
    id: z.string().max(200).optional(),
    label: z.string().trim().min(1).max(100),
    connector: z.string().trim().min(1).max(200),
    action: z.string().trim().min(1).max(200),
    decision: z.enum(["allow", "review", "deny"]),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("any") }),
      z.object({ kind: z.literal("exact"), value: z.json() }),
      z.object({
        kind: z.literal("field"),
        path: z.array(z.string().min(1).max(100)).min(1).max(8),
        value: z.union([z.string().max(2000), z.boolean(), z.number()])
      }),
      z.object({ kind: z.literal("origin"), field: z.string().min(1).max(100), origin: z.url() })
    ]),
    taskId: z.string().min(1).max(300).nullable().default(null),
    expiresAt: z.iso.datetime().nullable().default(null)
  })
  .superRefine((input, ctx) => {
    if (input.connector.includes("*") || input.action.includes("*"))
      ctx.addIssue({ code: "custom", message: "Choose an exact connection and action" });
    if (input.scope.kind === "origin") {
      let valid = false;
      try {
        const url = new URL(input.scope.origin);
        valid = ["https:", "http:"].includes(url.protocol) && url.origin === input.scope.origin;
      } catch {
        /* Invalid origins are rejected below. */
      }
      if (!valid)
        ctx.addIssue({
          code: "custom",
          message: "Use an exact web origin, such as https://example.com"
        });
    }
  });
export type PermissionRule = PermissionRuleInput & { id: string; createdAt: string };
export type PermissionDecision = "allow" | "review" | "deny";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
export function permissionMatches(
  rule: PermissionRule,
  connector: string,
  action: string,
  input: unknown,
  taskId: string | null,
  at = Date.now()
): boolean {
  if (
    rule.connector !== connector ||
    rule.action !== action ||
    (rule.taskId && rule.taskId !== taskId) ||
    (rule.expiresAt && Date.parse(rule.expiresAt) <= at)
  )
    return false;
  const scope = rule.scope;
  if (scope.kind === "any") return true;
  if (scope.kind === "exact") return canonical(scope.value) === canonical(input);
  if (scope.kind === "origin") {
    if (!input || typeof input !== "object") return false;
    const value = Object.getOwnPropertyDescriptor(input, scope.field)?.value;
    try {
      return typeof value === "string" && new URL(value).origin === scope.origin;
    } catch {
      return false;
    }
  }
  let value: unknown = input;
  for (const key of scope.path) {
    if (
      !value ||
      typeof value !== "object" ||
      ["__proto__", "prototype", "constructor"].includes(key)
    )
      return false;
    value = Object.getOwnPropertyDescriptor(value, key)?.value;
  }
  return value === scope.value;
}
export function resolvePermission(
  rules: PermissionRule[],
  connector: string,
  action: string,
  input: unknown,
  taskId: string | null,
  fallback: PermissionDecision = "review"
): PermissionDecision {
  const matches = rules.filter((rule) => permissionMatches(rule, connector, action, input, taskId));
  return matches.some((rule) => rule.decision === "deny")
    ? "deny"
    : matches.some((rule) => rule.decision === "review")
      ? "review"
      : matches.some((rule) => rule.decision === "allow")
        ? "allow"
        : fallback;
}
