import type { AdminPolicy } from "../domain/admin-policy";
import type { AutomationsRpc, RoutineSchedule } from "../domain/automations";
import type { KnowledgeRpc } from "../domain/knowledge";
import type { LocalDevice, LocalJob } from "../domain/local-devices";
import type { HQBotModelId } from "../domain/models";
import type { ProjectsRpc } from "../domain/projects";
import type { TeamWorkRpc } from "../domain/team-work";
import type { BotFile } from "../domain/types";
import type { ActiveWork } from "./work";

export interface TaskProjectionDto {
  botId: string;
  work: Omit<ActiveWork, "scheduleId">;
}

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
  createdAt?: string;
  content: string;
}

export interface WorkspaceSkillDto {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

export interface WorkspaceRoutineDto {
  schedule?: RoutineSchedule;
  id: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  active: boolean;
  nextRunAt: string;
}

export interface ModelReservationDto {
  teamWorkId?: string;
  eventId: string;
  botId: string;
  taskId: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicroUsd: number;
  unpriced: boolean;
}

export interface ModelUsageDto {
  teamWorkId?: string;
  eventId?: string;
  unpriced?: boolean;
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

export interface WorkspaceAgentRpc extends KnowledgeRpc, ProjectsRpc, AutomationsRpc, TeamWorkRpc {
  getAdminPolicy(): Promise<AdminPolicy>;
  listLocalDevices(botId?: string): Promise<LocalDevice[]>;
  readLocalJob(botId: string, id: string): Promise<LocalJob | null>;
  localResultAllowed(botId: string, id: string): Promise<boolean>;
  queueLocalCommand(
    botId: string,
    taskId: string | null,
    id: string,
    input: unknown
  ): Promise<LocalJob | null>;
  canAccessBot(userId: string, botId: string, write?: boolean): Promise<boolean>;
  getBot(botId: string): Promise<WorkspaceBotDto | null>;
  listMemories(
    botId: string,
    options?: { query?: string; before?: string }
  ): Promise<WorkspaceMemoryDto[]>;
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
  projectTask(input: TaskProjectionDto): Promise<void>;
  setTaskSubmission(taskId: string, submissionId: string): Promise<void>;
  syncTaskState(taskId: string, workState: string, wakeAt: string | null): Promise<void>;
  cancelTask(taskId: string): Promise<boolean>;
  reserveModelRequest(input: ModelReservationDto): Promise<void>;
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
