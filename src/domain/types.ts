export type TaskSource = "chat" | "email"
export type TaskStatus = "queued" | "working" | "researching" | "replying" | "completed" | "failed"

export interface BotProfile {
  id: string
  name: string
  title: string
  description: string
}

export interface BotTask {
  id: string
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

export interface BotSnapshot {
  profile: BotProfile
  routine: {
    name: string
    schedule: string
    mailboxAddress: string | null
    allowedSenders: string[]
    autoReply: boolean
  }
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
  source: TaskSource
  messageId?: string
  prompt?: string
}
