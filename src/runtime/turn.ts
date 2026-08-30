import type {
  ChatResponseResult,
  ThinkSubmissionInspection,
  TurnConfig,
  TurnContext
} from "@cloudflare/think";
import type { LanguageModel, UIMessage } from "ai";

import { mentionedTeammates } from "../domain/collaboration";
import { type HQBotModelId, normalizeHQBotModelId } from "../domain/models";
import { delegationInstructions } from "./collaboration";
import { activeTools, latestUserText, routeTurn, teammateInstructions } from "./routing";
import type { TeammateChatSubmission, TeammateTaskSubmission, WorkspaceAgentRpc } from "./types";

interface PrepareTeammateTurnInput {
  botId: string;
  connectedServices: readonly string[];
  context: TurnContext;
  maxSteps: number;
  modelFor(modelId: HQBotModelId): LanguageModel;
  metadata?: Record<string, unknown> | null;
  toolNames: readonly string[];
  workspaceAgent: WorkspaceAgentRpc;
}

interface DurableSubmissionOptions {
  channel: "web";
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  submissionId: string;
}

type SubmitMessages = (
  messages: UIMessage[],
  options: DurableSubmissionOptions
) => Promise<{ accepted: boolean; submissionId: string }>;

interface ChatAdmissionLifecycle {
  cancel(submissionId: string, reason: string): Promise<void>;
  inspect(submissionId: string): Promise<ThinkSubmissionInspection | null>;
  messageApplied(messageId: string): boolean;
  stopped(): Promise<boolean>;
}

export type TeammateChatSubmissionResult =
  | { accepted: true; submissionId: string }
  | {
      accepted: false;
      submissionId: string;
      status: ThinkSubmissionInspection["status"];
      error?: string;
      messageApplied: boolean;
    };

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
  const metadata = { taskId, source: input.source };
  return {
    message: {
      id: `task:${taskId}`,
      role: "user",
      parts: [{ type: "text", text: prompt }],
      // The current Think submitMessages path stores options.metadata in its
      // ledger but does not stamp it on the message used by lifecycle hooks.
      metadata: { turnMetadata: metadata }
    },
    metadata
  };
}

export function createSubmittedChatMessage(input: TeammateChatSubmission): {
  message: UIMessage;
  submissionId: string;
} {
  const submissionId = safeTaskId(input.submissionId);
  const prompt = input.prompt.trim().slice(0, 100_000);
  if (prompt.length === 0) throw new Error("Chat message is required");
  return {
    message: {
      id: `chat:${submissionId}`,
      role: "user",
      parts: [{ type: "text", text: prompt }]
    },
    submissionId
  };
}

export async function submitChatTurn(
  input: TeammateChatSubmission,
  submit: SubmitMessages,
  lifecycle: ChatAdmissionLifecycle
): Promise<TeammateChatSubmissionResult | null> {
  const { message, submissionId } = createSubmittedChatMessage(input);
  if (await lifecycle.stopped()) return null;
  const result = await submit([message], {
    submissionId,
    idempotencyKey: `chat:${submissionId}`,
    channel: "web"
  });
  if (await lifecycle.stopped()) {
    await lifecycle.cancel(result.submissionId, "The owner stopped this teammate");
    return null;
  }
  if (result.accepted) return { accepted: true, submissionId: result.submissionId };
  const inspection = await lifecycle.inspect(result.submissionId);
  if (!inspection) throw new Error("The chat submission state is not available");
  return {
    accepted: false,
    submissionId: result.submissionId,
    status: inspection.status,
    ...(inspection.error ? { error: inspection.error } : {}),
    messageApplied: lifecycle.messageApplied(message.id)
  };
}

export async function submitTaskTurn(
  input: TeammateTaskSubmission,
  submit: SubmitMessages
): Promise<{ accepted: boolean; submissionId: string }> {
  const { message, metadata } = createSubmittedTaskMessage(input);
  const taskId = metadata.taskId;
  const result = await submit([message], {
    submissionId: taskId,
    idempotencyKey: `task:${taskId}`,
    metadata,
    channel: "web"
  });
  return { accepted: result.accepted, submissionId: result.submissionId };
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
  result: ChatResponseResult;
  workspaceAgent: WorkspaceAgentRpc;
}): Promise<void> {
  const taskId = input.metadata?.taskId;
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
  if (input.result.status === "error") {
    await input.workspaceAgent.failTask(taskId, input.result.error ?? "The task failed");
  } else if (input.result.status === "completed" && text) {
    await input.workspaceAgent.completeTask(taskId, text);
  }
}

export async function prepareTeammateTurn(input: PrepareTeammateTurnInput): Promise<TurnConfig> {
  const route = routeTurn({
    messages: input.context.messages,
    body: input.context.body,
    metadata: input.metadata ?? undefined,
    connectedServices: input.connectedServices
  });
  const delegated = input.context.body?.delegation === true;
  const taskId = input.metadata?.taskId;
  const occurredAt = new Date().toISOString();
  const [bot, bots, memories, skills, spendPolicy] = await Promise.all([
    input.workspaceAgent.getBot(input.botId),
    input.workspaceAgent.listBots(),
    input.workspaceAgent.listMemories(input.botId),
    input.workspaceAgent.listSkills(input.botId),
    input.workspaceAgent.checkSpendPolicy(input.botId, typeof taskId === "string" ? taskId : null)
  ]);
  if (!spendPolicy.allowed) throw new Error(spendPolicy.reason ?? "The cost budget was reached");
  await input.workspaceAgent.markInteraction(input.botId, occurredAt);

  const collaborators = delegated
    ? []
    : mentionedTeammates(latestUserText(input.context.messages), input.botId, bots);
  const canDelegate = collaborators.length > 0;
  const instructions = teammateInstructions({
    bot,
    connectedServices: input.connectedServices,
    memories,
    skills,
    route
  });
  return {
    instructions: `${instructions}${canDelegate ? delegationInstructions(collaborators) : ""}`,
    activeTools: activeTools(route, input.toolNames, { canDelegate, readOnly: delegated }),
    maxSteps: route === "direct" ? (canDelegate ? 4 : 1) : delegated ? 4 : input.maxSteps,
    maxOutputTokens: route === "direct" ? 1_500 : delegated ? 2_500 : 5_000,
    model: input.modelFor(normalizeHQBotModelId(bot?.modelId)),
    temperature: route === "direct" ? 0.4 : 0.2
  };
}
