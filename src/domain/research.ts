import type { ResearchPlan } from "./types";

const privateIpv4 = [
  /^10\./u,
  /^127\./u,
  /^169\.254\./u,
  /^192\.168\./u,
  /^172\.(?:1[6-9]|2\d|3[01])\./u,
  /^0\./u
];

function isPrivateIpv6(host: string): boolean {
  if (!host.includes(":")) return false;
  const normalized = host.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("::ffff:")
  );
}

export function safeResearchUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example") ||
    isPrivateIpv6(host) ||
    (!host.includes(".") && !host.includes(":")) ||
    privateIpv4.some((pattern) => pattern.test(host))
  ) {
    return null;
  }
  url.hash = "";
  return url;
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function parseResearchPlan(value: unknown, fallbackPrompt: string): ResearchPlan {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const goal =
    typeof record.goal === "string" && record.goal.trim() ? record.goal.trim() : fallbackPrompt;
  const queries = stringList(record.queries, 2).map((query) => query.slice(0, 200));
  const urls = stringList(record.urls, 3)
    .map(safeResearchUrl)
    .filter((url): url is URL => url !== null)
    .map((url) => url.toString());
  if (queries.length === 0 && urls.length === 0) queries.push(goal.slice(0, 200));
  return { goal: goal.slice(0, 1_000), queries, urls };
}
