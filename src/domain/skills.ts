import type { BotSkill } from "./types";

export function skillCommand(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 40);
}

export function invokedSkill(prompt: string, skills: BotSkill[]): BotSkill | null {
  const command = /^\/([a-z0-9-]+)/iu.exec(prompt.trim())?.[1]?.toLowerCase();
  if (!command) return null;
  return skills.find((skill) => skillCommand(skill.name) === command) ?? null;
}
