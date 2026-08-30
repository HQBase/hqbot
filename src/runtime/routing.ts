import type { ModelMessage } from "ai";

import { hqbotModelName } from "../domain/models";
import type { WorkspaceBotDto, WorkspaceMemoryDto, WorkspaceSkillDto } from "./types";

export type TurnRoute = "direct" | "research";

const RESEARCH_PATTERN =
  /\b(browse|current|find online|latest|look up|online|research|search|source|verify|website|web)\b/iu;
const DIRECT_IDENTITY_PATTERN =
  /\b(what model|which model|who are you|your model|how are you|thank(?:s| you)|awesome)\b/iu;

function textPart(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return record.type === "text" && typeof record.text === "string" ? record.text : "";
}

export function latestUserText(messages: readonly ModelMessage[]): string {
  const message = [...messages].reverse().find((candidate) => candidate.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return Array.isArray(message.content) ? message.content.map(textPart).join("\n") : "";
}

function stringField(source: Record<string, unknown> | undefined, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

export function routeTurn(input: {
  messages: readonly ModelMessage[];
  body?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  connectedServices?: readonly string[];
}): TurnRoute {
  const mode = stringField(input.body, "mode") ?? stringField(input.metadata, "mode");
  const message = latestUserText(input.messages);
  if (mode === "research") return "research";
  if (mode === "direct" || mode === "chat") return "direct";
  if (DIRECT_IDENTITY_PATTERN.test(message) && !RESEARCH_PATTERN.test(message)) return "direct";
  const normalized = message.toLocaleLowerCase();
  if (
    input.connectedServices?.some((name) => {
      const candidate = name.trim().toLocaleLowerCase();
      return candidate.length > 1 && normalized.includes(candidate);
    })
  ) {
    return "research";
  }
  return RESEARCH_PATTERN.test(message) || /https?:\/\//iu.test(message) ? "research" : "direct";
}

const WORKSPACE_RESEARCH_TOOLS = ["read", "write", "edit", "list", "find", "grep"];
const READ_ONLY_WORKSPACE_TOOLS = new Set(["read", "list", "find", "grep"]);
const READ_ONLY_BROWSER_TOOLS = new Set([
  "browser_markdown",
  "browser_extract",
  "browser_links",
  "browser_scrape"
]);

interface ActiveToolOptions {
  canDelegate?: boolean;
  readOnly?: boolean;
}

export function activeTools(
  route: TurnRoute,
  availableTools: readonly string[],
  options: ActiveToolOptions = {}
): string[] {
  const enforceReadOnly = options.readOnly;
  const tools =
    route === "direct"
      ? []
      : [...WORKSPACE_RESEARCH_TOOLS, ...availableTools].filter(
          (name) =>
            !enforceReadOnly ||
            READ_ONLY_WORKSPACE_TOOLS.has(name) ||
            READ_ONLY_BROWSER_TOOLS.has(name)
        );
  if (options.canDelegate) tools.push("delegate_to_teammates");
  return [...new Set(tools)];
}

function section(title: string, lines: string[]): string {
  return lines.length > 0 ? `\n\n${title}\n${lines.join("\n")}` : "";
}

export function teammateInstructions(input: {
  bot: WorkspaceBotDto | null;
  connectedServices: readonly string[];
  memories: readonly WorkspaceMemoryDto[];
  skills: readonly WorkspaceSkillDto[];
  route: TurnRoute;
}): string {
  const bot = input.bot;
  const identity = bot
    ? `You are ${bot.name}. ${bot.description}\nYour brief: ${bot.brief}`
    : "You are an HQBot AI teammate.";
  const mode =
    input.route === "direct"
      ? "Answer directly. Do not browse or use tools."
      : "Use browser, workspace, and connected-service tools only when they help. Cite useful public sources.";
  const connections = input.connectedServices.map((name) => `- ${name}`);
  const memories = input.memories.slice(-12).map((item) => `- ${item.content.slice(0, 1_000)}`);
  const skills = input.skills
    .slice(0, 8)
    .map((item) => `- ${item.name}: ${item.instructions.slice(0, 2_000)}`);

  return `${identity}\nYou run on Cloudflare. Your selected model is ${hqbotModelName(bot?.modelId)}. If asked about your model, answer this without research.\n${mode}${section("Connected services", connections)}${section("Memory", memories)}${section("Skills", skills)}`;
}
