export const MAX_DELEGATED_TEAMMATES = 3;

export interface NamedTeammate {
  id: string;
  name: string;
  hidden: boolean;
}

function mentionIndex(prompt: string, name: string): number {
  const lowerPrompt = prompt.toLocaleLowerCase();
  const mention = `@${name.toLocaleLowerCase()}`;
  let index = lowerPrompt.indexOf(mention);
  while (index >= 0) {
    const next = lowerPrompt[index + mention.length];
    if (!next || !/[\p{L}\p{N}_-]/u.test(next)) return index;
    index = lowerPrompt.indexOf(mention, index + mention.length);
  }
  return -1;
}

export function mentionedTeammates<T extends NamedTeammate>(
  prompt: string,
  currentBotId: string,
  bots: readonly T[]
): T[] {
  return bots
    .filter((bot) => bot.id !== currentBotId && !bot.hidden)
    .map((bot) => ({ bot, index: mentionIndex(prompt, bot.name) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)
    .slice(0, MAX_DELEGATED_TEAMMATES)
    .map((item) => item.bot);
}
