import type { BotTeammate } from "./types"

export function mentionedTeammates(
  prompt: string,
  currentBotId: string,
  bots: BotTeammate[],
): BotTeammate[] {
  const lower = prompt.toLowerCase()
  return bots
    .filter(
      (bot) =>
        bot.id !== currentBotId && !bot.hidden && lower.includes(`@${bot.name.toLowerCase()}`),
    )
    .slice(0, 5)
}
