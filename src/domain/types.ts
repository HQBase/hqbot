export type TaskSource = "chat" | "email";
export type TaskStatus =
  | "queued"
  | "working"
  | "researching"
  | "awaiting_approval"
  | "replying"
  | "cancelled"
  | "completed"
  | "failed";

export interface BotConnection {
  id: string;
  provider: "hqbase";
  origin: string;
  mailboxId: string;
  mailboxAddress: string;
  mailboxName: string;
  active: boolean;
  realtimeStatus: "connected" | "connecting" | "disconnected";
  lastEventAt: string | null;
  createdAt: string;
}

export interface StoredBotConnection extends BotConnection {
  botId: string;
  tokenCiphertext: string;
  tokenIv: string;
  changeCursor: string | null;
}

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
  modelId: string | null;
  dailyBudgetUsd: number;
  createdAt: string;
  updatedAt: string;
  connection: BotConnection | null;
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

export interface BotSkill {
  id: string;
  botId: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComputerState {
  active: boolean;
  url: string | null;
  screenshotKey: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
}

export interface StoredComputerState extends ComputerState {
  sessionId: string | null;
  cookiesCiphertext: string | null;
  cookiesIv: string | null;
}

export interface BotTask {
  id: string;
  botId: string;
  connectionId: string | null;
  source: TaskSource;
  status: TaskStatus;
  prompt: string;
  subject: string | null;
  sender: string | null;
  sourceMessageId: string | null;
  submissionId: string | null;
  result: string | null;
  replyMessageId: string | null;
  screenshotKey: string | null;
  browserUrl: string | null;
  error: string | null;
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
  selectedBot: BotTeammate | null;
  tasks: BotTask[];
  activeTask: BotTask | null;
  activity: BotActivity[];
  memories: BotMemory[];
  routines: BotRoutine[];
  files: BotFile[];
  skills: BotSkill[];
  computer: ComputerState;
  costs: CostSnapshot;
}

export interface UsageEvent {
  id: string;
  botId: string | null;
  taskId: string | null;
  service: "workers-ai" | "browser" | "durable-object" | "r2";
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
  browser: CostTotal;
  workersAi: CostTotal;
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
    durableObjectGbSecondsPerDay: number;
    hqbaseRealtimeConnections: number;
    selectedBotHqbaseRealtime: boolean;
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

export interface ResearchPlan {
  goal: string;
  queries: string[];
  urls: string[];
}

export interface ResearchSource {
  title: string;
  url: string;
  text: string;
}

export interface ResearchResult {
  sources: ResearchSource[];
  screenshotKey: string | null;
  browserUrl: string | null;
}

export interface BotDefinition {
  name: string;
  title: string;
  description: string;
}
