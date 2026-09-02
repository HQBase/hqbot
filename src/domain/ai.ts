import type { BotDefinition } from "./types";

const teammateNames = [
  "Avery",
  "Cedar",
  "Ember",
  "Iris",
  "Juniper",
  "Marlow",
  "Milo",
  "Nora",
  "Orion",
  "Piper",
  "Sage",
  "Willow"
] as const;

export function generatedTeammateName(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return teammateNames[hash % teammateNames.length] ?? "Avery";
}

export function defineBot(brief: string): BotDefinition {
  const lower = brief.toLowerCase();
  const name =
    [
      ["inbox", "Inbox"],
      ["email", "Inbox"],
      ["research", "Research"],
      ["support", "Support"],
      ["sales", "Sales"],
      ["finance", "Finance"],
      ["operations", "Operations"]
    ].find(([keyword]) => lower.includes(keyword ?? ""))?.[1] ?? "Teammate";
  const cleanBrief = brief.replace(/\s+/gu, " ").trim();
  return {
    name,
    title: cleanBrief.slice(0, 100),
    description: `I will help with this job: ${cleanBrief.slice(0, 320)}`
  };
}

export function defineConversationBot(id: string): BotDefinition & { brief: string } {
  const name = generatedTeammateName(id);
  return {
    name,
    title: name,
    description: "A helpful teammate for everyday questions and tasks.",
    brief: "Answer the owner directly. Follow the instructions in the conversation."
  };
}
