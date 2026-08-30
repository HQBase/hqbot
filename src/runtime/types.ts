export const GLM_PRIMARY_MODEL_ID = "@cf/zai-org/glm-5.3-flash" as const;
export const DEEPSEEK_FALLBACK_MODEL_ID = "@cf/deepseek-ai/deepseek-v4-flash-0731" as const;

export type HQBotModelId = typeof GLM_PRIMARY_MODEL_ID | typeof DEEPSEEK_FALLBACK_MODEL_ID;

export interface WorkspaceBotDto {
  id: string;
  name: string;
  title: string;
  description: string;
  brief: string;
}

export interface WorkspaceTeammateDto extends WorkspaceBotDto {
  hidden: boolean;
}

export interface WorkspaceMemoryDto {
  id: string;
  content: string;
}

export interface WorkspaceSkillDto {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

export interface WorkspaceRoutineDto {
  id: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  active: boolean;
}

export interface WorkspaceConnectionDto {
  id: string;
  active: boolean;
  mailboxAddress: string;
}

export interface ModelUsageDto {
  botId: string;
  taskId: string | null;
  model: HQBotModelId;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estimatedCostMicroUsd: number;
  occurredAt: string;
}

export interface ResourceUsageDto {
  botId: string;
  taskId: string | null;
  service: "browser" | "durable-object" | "r2";
  units: number;
  estimatedCostMicroUsd: number;
}

export interface SpendPolicyDto {
  allowed: boolean;
  reason: string | null;
}

export interface SendApprovedReplyInput {
  botId: string;
  taskId: string;
  draft: string;
}

export interface SendApprovedReplyResult {
  messageId: string;
  duplicate: boolean;
}

export interface WorkspaceAgentRpc {
  getBot(botId: string): Promise<WorkspaceBotDto | null>;
  listBots(): Promise<WorkspaceTeammateDto[]>;
  listMemories(botId: string): Promise<WorkspaceMemoryDto[]>;
  listSkills(botId: string): Promise<WorkspaceSkillDto[]>;
  listRoutines(botId: string): Promise<WorkspaceRoutineDto[]>;
  getBotConnection(botId: string): Promise<WorkspaceConnectionDto | null>;
  checkSpendPolicy(botId: string, taskId: string | null): Promise<SpendPolicyDto>;
  recordUsage(usage: ModelUsageDto): Promise<void>;
  recordResourceUsage(usage: ResourceUsageDto): Promise<void>;
  markInteraction(botId: string, occurredAt: string): Promise<void>;
  requestReplyApproval(taskId: string, draft: string): Promise<boolean>;
  recordReplyDecision(taskId: string, approved: boolean): Promise<void>;
  completeTask(taskId: string, result: string, replyMessageId: string | null): Promise<void>;
  failTask(taskId: string, error: string): Promise<void>;
  sendApprovedReply(input: SendApprovedReplyInput): Promise<SendApprovedReplyResult>;
}

export interface DelegatedTaskInput {
  requesterId: string;
  task: string;
}

export interface DelegatedTaskResult {
  botId: string;
  name: string;
  report: string;
}

export interface TeammateTaskSubmission {
  taskId: string;
  source: "chat" | "email";
  prompt: string;
}

export interface LiveViewDto {
  sessionId: string;
  targets: Array<{
    targetId: string;
    url: string;
    pageUrl?: string;
    title?: string;
    type?: string;
  }>;
  expiresInMs: number;
}
