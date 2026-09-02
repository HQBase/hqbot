import type { HQBotModelId } from "../domain/models";
import type { BotFile } from "../domain/types";

export {
  DEEPSEEK_FALLBACK_MODEL_ID,
  GLM_PRIMARY_MODEL_ID,
  type HQBotModelId,
  type ModelTokenRates
} from "../domain/models";

export interface WorkspaceBotDto {
  id: string;
  name: string;
  title: string;
  description: string;
  brief: string;
  maxSteps: number | null;
  modelId: string | null;
  hidden?: boolean;
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
  nextRunAt: string;
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
  service: "durable-object" | "r2" | "sandbox";
  units: number;
  estimatedCostMicroUsd: number;
}

export interface SpendPolicyDto {
  allowed: boolean;
  reason: string | null;
}

export interface WorkspaceAgentRpc {
  getBot(botId: string): Promise<WorkspaceBotDto | null>;
  listMemories(botId: string): Promise<WorkspaceMemoryDto[]>;
  listSkills(botId: string): Promise<WorkspaceSkillDto[]>;
  listRoutines(botId: string): Promise<WorkspaceRoutineDto[]>;
  createRoutine(input: {
    id: string;
    botId: string;
    name: string;
    prompt: string;
    intervalMinutes: number;
    nextRunAt: string;
  }): Promise<WorkspaceRoutineDto>;
  setRoutineActive(id: string, botId: string, active: boolean): Promise<WorkspaceRoutineDto | null>;
  deleteRoutine(id: string, botId: string): Promise<boolean>;
  createFile(input: {
    id: string;
    botId: string;
    key: string;
    name: string;
    contentType: string;
    size: number;
  }): Promise<BotFile>;
  deleteFile(id: string, botId: string): Promise<BotFile | null>;
  getFile(id: string, botId: string): Promise<BotFile | null>;
  listFiles(botId: string): Promise<BotFile[]>;
  checkSpendPolicy(botId: string, taskId: string | null): Promise<SpendPolicyDto>;
  startTask(id: string, botId: string, prompt: string): Promise<void>;
  setTaskSubmission(taskId: string, submissionId: string): Promise<void>;
  syncTaskState(taskId: string, workState: string, wakeAt: string | null): Promise<void>;
  cancelTask(taskId: string): Promise<boolean>;
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

export interface TeammateChatSubmission {
  submissionId: string;
  prompt: string;
}
