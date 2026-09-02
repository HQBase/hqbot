import type {
  ChatResponseResult,
  ThinkSubmissionInspection,
  TurnConfig,
  TurnContext
} from "@cloudflare/think";
import type { LanguageModel, StopCondition, ToolSet, UIMessage } from "ai";

import { type HQBotModelId, hqbotModelName, normalizeHQBotModelId } from "../domain/models";
import type { BotFile } from "../domain/types";
import type {
  TeammateChatSubmission,
  WorkspaceAgentRpc,
  WorkspaceBotDto,
  WorkspaceMemoryDto,
  WorkspaceSkillDto
} from "./types";
import type { ActiveWork } from "./work";

interface PrepareTeammateTurnInput {
  activeTools?: string[];
  activeWork?: ActiveWork | null;
  botId: string;
  connectedServices: readonly string[];
  context: TurnContext;
  maxSteps: number;
  modelFor(modelId: HQBotModelId): LanguageModel;
  metadata?: Record<string, unknown> | null;
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

export const stopAfterBashHandoff: StopCondition<ToolSet> = ({ steps }) =>
  steps
    .at(-1)
    ?.toolResults.some(
      (result) =>
        result.toolName === "bash" &&
        typeof result.output === "object" &&
        result.output !== null &&
        "type" in result.output &&
        result.output.type === "sandbox_process"
    ) ?? false;

function section(title: string, lines: string[]): string {
  return lines.length > 0 ? `\n\n${title}\n${lines.join("\n")}` : "";
}

export function teammateInstructions(input: {
  activeWork?: ActiveWork | null;
  attachedFileIds?: readonly string[];
  bot: WorkspaceBotDto | null;
  connectedServices: readonly string[];
  files?: readonly BotFile[];
  memories: readonly WorkspaceMemoryDto[];
  skills: readonly WorkspaceSkillDto[];
}): string {
  const bot = input.bot;
  const identity = bot
    ? `You are ${bot.name}. ${bot.description}\nYour brief: ${bot.brief}`
    : "You are an HQBot AI teammate.";
  const capabilities = `You have one private Cloudflare Linux computer. Bash, visible Chrome, and other installed Linux GUI applications all run in this same computer. Use any useful capability to complete the owner's request.
Use desktop_screenshot to inspect any visible Linux app, desktop_mouse to move, click, drag, or scroll, and desktop_keyboard to type or press keys.
For Chrome, use browser_snapshot, browser_click, browser_type, and browser_press before desktop coordinates or browser_evaluate. Use browser_evaluate last. If a tool fails, correct its input or change methods; never repeat the same failed call unchanged. Use coordinates only from the latest desktop_screenshot.
Use computer_session with give_to_owner when the owner asks for control or must enter a password, passkey, MFA code, or CAPTCHA. Never ask for those secrets in chat or enter them with computer tools. Tell the owner to reply when they are done. Then use computer_session with take_back before you continue computer actions.
Never search the computer for credentials. Never read, export, copy, log, or save passwords, cookies, session tokens, browser profiles, or other authentication secrets into task state, Files, R2, or any other durable storage. Keep authenticated browser state only in the browser.
Before you end a turn after give_to_owner, call manage_task with needs_user and save what must happen after the owner replies.
For local file work, use /workspace/hqbot. Bash only runs commands; it does not move files to or from durable Files. Use list_files to inspect durable Files, copy_file_to_computer to copy one into the computer, upload_file to save one computer file to Files/R2 for the owner, and delete_file only when the owner asks to delete a durable file. Use Bash rm only when a local computer file must be deleted. After upload_file saves the requested deliverable, reply to the owner unless more work was requested.
When Chrome opens a local file, give it an absolute file:/// URL, such as file:///workspace/hqbot/report.html. A bare local path is a web address to Chrome and is rejected by the computer with a correct usage example.
Bash automatically returns quick results in this turn and supervises slow commands as tasks. Do not choose a foreground or background mode, call manage_task for a supervised Bash process, or run that command again. Use stop_process with the returned process ID only when that managed command must end early. The Linux disk can reset after sleep, so Files in R2 are authoritative.
Use connected-service tools only when they help. Cite useful public sources.
Before you build repeated work around an authenticated site or API, do one bounded authentication check. If it returns 401 or 403, stop and ask the owner for the required action. Do not retry the same authorization failure.
Every owner message is a normal conversation turn. If no task is active and you can finish now, reply normally and do not call manage_task. Call manage_task once near the end only when work must continue in the next turn, wait for the owner, or finish an existing active task. Save a complete, compact checkpoint. When an active task finishes, call manage_task with done before your final reply.

Use schedule with create_once for one future wake-up, such as a reminder. For monitoring or repeated work, use schedule with create_recurring. Each scheduled run is one bounded turn. Do not implement waiting or monitoring as a Bash loop.
Before a normal turn ends, give the owner a concise result or exact blocker.`;
  const connections = input.connectedServices.map((name) => `- ${name}`);
  const memories = input.memories.slice(-12).map((item) => `- ${item.content.slice(0, 1_000)}`);
  const skills = input.skills
    .slice(0, 8)
    .map((item) => `- ${item.name}: ${item.instructions.slice(0, 2_000)}`);
  const attached = new Set(input.attachedFileIds ?? []);
  const files = (input.files ?? [])
    .slice(0, 12)
    .map(
      (file) =>
        `- ID ${file.id}: ${file.name} (${file.contentType}, ${file.size} bytes)${attached.has(file.id) ? " [attached now]" : ""}`
    );
  const activeWork = input.activeWork
    ? [
        `- ID: ${input.activeWork.taskId}`,
        `- State: ${input.activeWork.state}`,
        `- Goal: ${input.activeWork.goal}`,
        `- Checkpoint: ${input.activeWork.checkpoint}`
      ]
    : [];

  return `${identity}\nYou run on Cloudflare. Your selected model is ${hqbotModelName(bot?.modelId)}. If asked about your model, answer this without research.\n${capabilities}${section("Active task", activeWork)}${section("Files", files)}${section("Connected services", connections)}${section("Memory", memories)}${section("Skills", skills)}`;
}

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

export function teammateResponseText(result: ChatResponseResult): string {
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
  interactionStatus?: "working" | "idle" | "needs_approval";
  result: ChatResponseResult;
  workspaceAgent: WorkspaceAgentRpc;
}): Promise<void> {
  const text = teammateResponseText(input.result);
  const summary =
    input.result.status === "completed"
      ? text.replace(/\s+/gu, " ") || "Chat completed"
      : input.result.status === "error"
        ? "Chat failed"
        : "Chat stopped";
  await input.workspaceAgent.markInteraction(
    input.botId,
    summary,
    input.interactionStatus ?? "idle"
  );
}

export async function prepareTeammateTurn(input: PrepareTeammateTurnInput): Promise<TurnConfig> {
  const attachedFileIds = Array.isArray(input.context.body?.artifactIds)
    ? input.context.body.artifactIds.filter(
        (value): value is string => typeof value === "string" && value.length <= 100
      )
    : [];
  const taskId = input.metadata?.taskId ?? input.activeWork?.taskId;
  const occurredAt = new Date().toISOString();
  const [bot, memories, skills, files, spendPolicy] = await Promise.all([
    input.workspaceAgent.getBot(input.botId),
    input.workspaceAgent.listMemories(input.botId),
    input.workspaceAgent.listSkills(input.botId),
    input.workspaceAgent.listFiles(input.botId),
    input.workspaceAgent.checkSpendPolicy(input.botId, typeof taskId === "string" ? taskId : null)
  ]);
  if (!spendPolicy.allowed) throw new Error(spendPolicy.reason ?? "The cost budget was reached");
  await input.workspaceAgent.markInteraction(input.botId, occurredAt);

  const instructions = teammateInstructions({
    activeWork: input.activeWork,
    attachedFileIds,
    bot,
    connectedServices: input.connectedServices,
    files,
    memories,
    skills
  });
  const config: TurnConfig = {
    ...(input.activeTools ? { activeTools: input.activeTools } : {}),
    instructions,
    maxSteps: bot?.maxSteps ?? input.maxSteps,
    maxOutputTokens: 5_000,
    model: input.modelFor(normalizeHQBotModelId(bot?.modelId)),
    stopWhen: stopAfterBashHandoff,
    temperature: 0.2
  };
  return config;
}
