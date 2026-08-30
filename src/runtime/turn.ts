import type { ChatResponseResult, TurnConfig, TurnContext } from "@cloudflare/think";
import type { UIMessage } from "ai";

import { mentionedTeammates } from "../domain/collaboration";
import type { ReplyApproval } from "./approval";
import { delegationInstructions } from "./collaboration";
import { activeTools, latestUserText, routeTurn, teammateInstructions } from "./routing";
import type { TeammateTaskSubmission, WorkspaceAgentRpc } from "./types";

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

export function createSubmittedTaskMessage(input: TeammateTaskSubmission): {
  message: UIMessage;
  metadata: { taskId: string; source: TeammateTaskSubmission["source"] };
} {
  const taskId = safeTaskId(input.taskId);
  const prompt = input.prompt.trim().slice(0, 100_000);
  if (prompt.length === 0) throw new Error("Task prompt is required");
  const text = input.source === "email" ? `[hqbot:email]\nTask ID: ${taskId}\n\n${prompt}` : prompt;
  const metadata = { taskId, source: input.source };
  return {
    message: {
      id: `task:${taskId}`,
      role: "user",
      parts: [{ type: "text", text }],
      // The current Think submitMessages path stores options.metadata in its
      // ledger but does not stamp it on the message used by lifecycle hooks.
      metadata: { turnMetadata: metadata }
    },
    metadata
  };
}

function responseText(result: ChatResponseResult): string {
  return result.message.parts
    .filter(
      (part): part is Extract<(typeof result.message.parts)[number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export async function finishTeammateResponse(input: {
  botId: string;
  metadata?: Record<string, unknown> | null;
  replyApproval: ReplyApproval | null;
  result: ChatResponseResult;
  workspaceAgent: WorkspaceAgentRpc;
}): Promise<void> {
  const taskId = input.metadata?.taskId;
  const source = input.metadata?.source;
  const text = responseText(input.result);
  if (typeof taskId !== "string") {
    const summary =
      input.result.status === "completed"
        ? text.replace(/\s+/gu, " ") || "Chat completed"
        : input.result.status === "error"
          ? "Chat failed"
          : "Chat stopped";
    await input.workspaceAgent.markInteraction(input.botId, summary, "idle");
    return;
  }
  if (source === "email") {
    if (input.replyApproval) {
      await input.workspaceAgent.requestReplyApproval(taskId, input.replyApproval.draft);
    } else if (input.result.status === "error") {
      await input.workspaceAgent.failTask(taskId, input.result.error ?? "The email task failed");
    } else if (input.result.status === "completed") {
      await input.workspaceAgent.failTask(
        taskId,
        "The email task finished without producing a reply for approval"
      );
    }
    return;
  }
  if (input.result.status === "error") {
    await input.workspaceAgent.failTask(taskId, input.result.error ?? "The task failed");
  } else if (input.result.status === "completed" && text) {
    await input.workspaceAgent.completeTask(taskId, text, null);
  }
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
