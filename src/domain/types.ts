export type TaskSource = "chat";
export type TaskStatus =
  | "queued"
  | "working"
  | "researching"
  | "cancelled"
  | "completed"
  | "failed";

export interface BotTeammate {
  id: string;
  name: string;
  title: string;
  description: string;
  brief: string;
  pinned: boolean;
  hidden: boolean;
  status: "idle" | "working" | "needs_approval" | "offline";
  lastInteractedAt: string | null;
  lastMessage: string | null;
  maxSteps: number | null;
  modelId: string | null;
  dailyBudgetUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface BotMemory {
  id: string;
  botId: string;
  content: string;
  createdAt: string;
}

export interface BotRoutine {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  active: boolean;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BotFile {
  id: string;
  botId: string;
  taskId: string | null;
  key: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export type ArtifactReference = Pick<
  BotFile,
  "id" | "botId" | "name" | "contentType" | "size" | "createdAt"
>;

export interface BotSkill {
  id: string;
  botId: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

export interface BotTask {
  id: string;
  botId: string;
  source: TaskSource;
  status: TaskStatus;
  prompt: string;
  submissionId: string | null;
  result: string | null;
  error: string | null;
  workState: string | null;
  wakeAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotActivity {
  id: string;
  taskId: string;
  phase: string;
  title: string;
  detail: string | null;
  createdAt: string;
}

export interface WorkspaceSnapshot {
  bots: BotTeammate[];
  archivedBots: BotTeammate[];
  selectedBot: BotTeammate | null;
  tasks: BotTask[];
  activeTask: BotTask | null;
  activity: BotActivity[];
  memories: BotMemory[];
  routines: BotRoutine[];
  files: BotFile[];
  skills: BotSkill[];
  costs: CostSnapshot;
}

export interface UsageEvent {
  id: string;
  botId: string | null;
  taskId: string | null;
  service: "workers-ai" | "durable-object" | "r2" | "sandbox";
  inputUnits: number;
  outputUnits: number;
  estimatedUsd: number;
  createdAt: string;
}

export interface CostTotal {
  estimatedUsd: number;
  inputUnits: number;
  outputUnits: number;
}

export interface CostServiceTotals {
  sandbox: CostTotal;
  workersAi: CostTotal;
}

export interface CloudflareResourceFootprint {
  durableObjects: number;
  agentSchedules: number;
  taskSubmissionsToday: number;
  r2FileObjects: number;
  r2FileBytes: number;
}

export interface CostSnapshot {
  overall: CostTotal;
  selectedBot: CostTotal;
  selectedTask: CostTotal;
  dayStartedAt: string;
  services: {
    overall: CostServiceTotals;
    selectedBot: CostServiceTotals;
    selectedTask: CostServiceTotals;
  };
  platform: {
    resources: {
      overall: CloudflareResourceFootprint;
      selectedBot: CloudflareResourceFootprint;
    };
  };
}

export interface UsageInput {
  id: string;
  botId?: string | null;
  taskId?: string | null;
  service: UsageEvent["service"];
  inputUnits?: number;
  outputUnits?: number;
  estimatedUsd: number;
}

export interface BotDefinition {
  name: string;
  title: string;
  description: string;
}
