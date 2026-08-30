import type { HQBotModelId } from "../domain/models";

export {
  DEEPSEEK_FALLBACK_MODEL_ID,
  GLM_PRIMARY_MODEL_ID,
  type HQBotModelId
} from "../domain/models";

export interface WorkspaceBotDto {
  id: string;
  name: string;
  title: string;
  description: string;
  brief: string;
  modelId: string | null;
  hidden?: boolean;
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
  eventId?: string;
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

export interface WorkspaceAgentRpc {
  getBot(botId: string): Promise<WorkspaceBotDto | null>;
  listBots(): Promise<WorkspaceTeammateDto[]>;
  listMemories(botId: string): Promise<WorkspaceMemoryDto[]>;
  listSkills(botId: string): Promise<WorkspaceSkillDto[]>;
  listRoutines(botId: string): Promise<WorkspaceRoutineDto[]>;
  checkSpendPolicy(botId: string, taskId: string | null): Promise<SpendPolicyDto>;
  recordUsage(usage: ModelUsageDto): Promise<void>;
  recordResourceUsage(usage: ResourceUsageDto): Promise<void>;
  markInteraction(
    botId: string,
    occurredAtOrMessage: string,
    status?: "working" | "idle" | "needs_approval"
  ): Promise<void>;
  completeTask(taskId: string, result: string): Promise<void>;
  failTask(taskId: string, error: string): Promise<void>;
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
  source: "chat";
  prompt: string;
}

export interface TeammateChatSubmission {
  submissionId: string;
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
