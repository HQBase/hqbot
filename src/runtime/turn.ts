import type { TurnConfig, TurnContext } from "@cloudflare/think";

import { mentionedTeammates } from "../domain/collaboration";
import { delegationInstructions } from "./collaboration";
import { activeTools, latestUserText, routeTurn, teammateInstructions } from "./routing";
import type { WorkspaceAgentRpc } from "./types";

interface PrepareTeammateTurnInput {
  botId: string;
  browserTools: readonly string[];
  context: TurnContext;
  maxSteps: number;
  metadata?: Record<string, unknown> | null;
  workspaceAgent: WorkspaceAgentRpc;
}

export function safeTaskId(value: string): string {
  const taskId = value.trim();
  if (taskId.length === 0 || taskId.length > 200) throw new Error("Invalid task ID");
  return taskId;
}

export async function prepareTeammateTurn(input: PrepareTeammateTurnInput): Promise<TurnConfig> {
  const route = routeTurn({
    messages: input.context.messages,
    body: input.context.body,
    metadata: input.metadata ?? undefined
  });
  const delegated = input.context.body?.delegation === true;
  const taskId = input.metadata?.taskId;
  const occurredAt = new Date().toISOString();
  const [bot, bots, memories, skills, connection, spendPolicy] = await Promise.all([
    input.workspaceAgent.getBot(input.botId),
    input.workspaceAgent.listBots(),
    input.workspaceAgent.listMemories(input.botId),
    input.workspaceAgent.listSkills(input.botId),
    input.workspaceAgent.getBotConnection(input.botId),
    input.workspaceAgent.checkSpendPolicy(input.botId, typeof taskId === "string" ? taskId : null),
    input.workspaceAgent.markInteraction(input.botId, occurredAt)
  ]);
  if (!spendPolicy.allowed) throw new Error(spendPolicy.reason ?? "The cost budget was reached");

  const collaborators = delegated
    ? []
    : mentionedTeammates(latestUserText(input.context.messages), input.botId, bots);
  const canDelegate = collaborators.length > 0;
  const instructions = teammateInstructions({ bot, memories, skills, connection, route });
  return {
    instructions: `${instructions}${canDelegate ? delegationInstructions(collaborators) : ""}`,
    activeTools: activeTools(route, input.browserTools, { canDelegate, readOnly: delegated }),
    maxSteps: route === "direct" ? (canDelegate ? 4 : 1) : delegated ? 4 : input.maxSteps,
    maxOutputTokens: route === "direct" ? 1_500 : delegated ? 2_500 : 5_000,
    temperature: route === "direct" ? 0.4 : 0.2
  };
}
