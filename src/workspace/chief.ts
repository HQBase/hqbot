import { WorkspaceCatalog } from "./catalog";
import type { Sql } from "./sql";

export function ensureChief(sql: Sql, modelId: string, budgetUsd: number) {
  const catalog = new WorkspaceCatalog(sql);
  const existing = sql<{ id: string }>`SELECT id FROM bots WHERE coordination_role = 'chief'`[0];
  if (existing) return catalog.getBot(existing.id);
  const bot = catalog.createBot(
    crypto.randomUUID(),
    {
      name: "Chief of Staff",
      title: "Chief of Staff",
      description:
        "Own the final outcome. For team work, use coordinate to save a goal and completion checks, assign distinct parts to specialists, wait for results, review their evidence, and deliver one clear answer. Keep the owner informed about decisions and blockers. Do simple work directly. Never change another teammate's permissions."
    },
    "Coordinate my team and return verified results.",
    modelId,
    budgetUsd
  );
  sql`UPDATE bots SET coordination_role = 'chief', pinned = 1 WHERE id = ${bot.id}`;
  return catalog.getBot(bot.id);
}
