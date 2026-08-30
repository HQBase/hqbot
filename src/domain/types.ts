export type TaskSource = "chat" | "email"
export type TaskStatus = "queued" | "working" | "researching" | "replying" | "completed" | "failed"

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
  createdAt: string
  updatedAt: string
  connection: BotConnection | null
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
}

export interface BotDefinition {
  name: string
  title: string
  description: string
}
