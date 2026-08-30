export type TaskSource = "chat" | "email"
export type TaskStatus =
  | "queued"
  | "working"
  | "researching"
  | "awaiting_approval"
  | "replying"
  | "completed"
  | "failed"

export interface BotConnection {
  id: string
  provider: "hqbase"
  origin: string
  mailboxId: string
  mailboxAddress: string
  mailboxName: string
  active: boolean
  createdAt: string
}

export interface StoredBotConnection extends BotConnection {
  botId: string
  tokenCiphertext: string
  tokenIv: string
}

export interface BotTeammate {
  id: string
  name: string
  title: string
  description: string
  brief: string
  pinned: boolean
  hidden: boolean
  createdAt: string
  updatedAt: string
  connection: BotConnection | null
}

export interface BotMemory {
  id: string
  botId: string
  content: string
  createdAt: string
}

export interface BotRoutine {
  id: string
  botId: string
  name: string
  prompt: string
  intervalMinutes: number
  active: boolean
  nextRunAt: string
  createdAt: string
  updatedAt: string
}

export interface BotFile {
  id: string
  botId: string
  taskId: string | null
  key: string
  name: string
  contentType: string
  size: number
  createdAt: string
}

export interface BotSkill {
  id: string
  botId: string
  name: string
  description: string
  instructions: string
  createdAt: string
  updatedAt: string
}

export interface ComputerState {
  active: boolean
  url: string | null
  screenshotKey: string | null
  expiresAt: string | null
  updatedAt: string | null
}

export interface StoredComputerState extends ComputerState {
  sessionId: string | null
  cookiesCiphertext: string | null
  cookiesIv: string | null
}

export interface BotTask {
  id: string
  botId: string
  connectionId: string | null
  source: TaskSource
  status: TaskStatus
  prompt: string
  subject: string | null
  sender: string | null
  sourceMessageId: string | null
  workflowId: string | null
  result: string | null
  replyMessageId: string | null
  screenshotKey: string | null
  browserUrl: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface BotActivity {
  id: string
  taskId: string
  phase: string
  title: string
  detail: string | null
  createdAt: string
}

export interface WorkspaceSnapshot {
  bots: BotTeammate[]
  selectedBot: BotTeammate | null
  tasks: BotTask[]
  activeTask: BotTask | null
  activity: BotActivity[]
  memories: BotMemory[]
  routines: BotRoutine[]
  files: BotFile[]
  skills: BotSkill[]
  computer: ComputerState
}

export interface ResearchPlan {
  goal: string
  queries: string[]
  urls: string[]
}

export interface ResearchSource {
  title: string
  url: string
  text: string
}

export interface ResearchResult {
  sources: ResearchSource[]
  screenshotKey: string | null
  browserUrl: string | null
}

export interface WorkflowInput {
  taskId: string
  botId: string
  source: TaskSource
  connectionId?: string
  messageId?: string
  prompt?: string
  collaboratorIds?: string[]
  skillId?: string
}

export interface BotDefinition {
  name: string
  title: string
  description: string
}
