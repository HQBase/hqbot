import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { getAgentByName } from "agents"

import type { HQBotAgent } from "./agent"
import type { ResearchPlan, ResearchResult, WorkflowInput } from "./domain/types"
import { planResearch, writeResult } from "./services/ai"
import { researchWithBrowser } from "./services/browser"
import {
  existingReply,
  getMessage,
  getThread,
  type MailConfig,
  replyToMessage,
} from "./services/mail"

function required(value: string | undefined, name: string): string {
  const clean = value?.trim()
  if (!clean) throw new Error(`${name} is not configured`)
  return clean
}

function mailConfig(env: Env): MailConfig {
  return {
    origin: required(env.HQBASE_ORIGIN, "HQBASE_ORIGIN"),
    mailboxId: required(env.HQBASE_MAILBOX_ID, "HQBASE_MAILBOX_ID"),
    mailboxAddress: required(env.HQBASE_MAILBOX_ADDRESS, "HQBASE_MAILBOX_ADDRESS"),
    token: required(env.HQBASE_AGENT_TOKEN, "HQBASE_AGENT_TOKEN"),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The task failed for an unknown reason"
}

async function bot(env: Env) {
  return getAgentByName<Env, HQBotAgent>(env.HQBOT_AGENT, env.HQBOT_ID)
}

export class HQBotWorkflow extends WorkflowEntrypoint<Env, WorkflowInput> {
  async run(event: WorkflowEvent<WorkflowInput>, step: WorkflowStep): Promise<{ taskId: string }> {
    const input = event.payload
    const agent = await bot(this.env)
    try {
      const prompt = await step.do("read request", async () => {
        if (input.source === "chat") return required(input.prompt, "prompt")
        const messageId = required(input.messageId, "messageId")
        const message = await getMessage(mailConfig(this.env), messageId)
        const request = [`Subject: ${message.subject}`, message.textBody || message.snippet]
          .filter(Boolean)
          .join("\n\n")
        await agent.setTaskInput(input.taskId, request, message.subject, message.fromAddress)
        return request
      })

      await step.do("start task", async () => {
        await agent.setStatus(input.taskId, "working")
        await agent.addActivity(
          input.taskId,
          "planning",
          "Planning research",
          "Workers AI is choosing public sources and search terms.",
        )
      })

      const plan = await step.do<ResearchPlan>(
        "plan research",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        async () => planResearch(this.env.AI, this.env.HQBOT_MODEL_ID, prompt),
      )

      await step.do("show browser work", async () => {
        await agent.setStatus(input.taskId, "researching")
        await agent.addActivity(
          input.taskId,
          "browser",
          "Using cloud browser",
          `${plan.urls.length} direct source${plan.urls.length === 1 ? "" : "s"} and ${plan.queries.length} search quer${plan.queries.length === 1 ? "y" : "ies"}.`,
        )
      })

      const research = await step.do<ResearchResult>(
        "research public web",
        { retries: { limit: 2, delay: "10 seconds", backoff: "linear" }, timeout: "3 minutes" },
        async () => researchWithBrowser(this.env.BROWSER, this.env.ARTIFACTS, input.taskId, plan),
      )

      await step.do("save browser evidence", async () => {
        await agent.recordBrowser(input.taskId, research.screenshotKey, research.browserUrl)
        await agent.addActivity(
          input.taskId,
          "writing",
          "Writing from evidence",
          `${research.sources.length} public source${research.sources.length === 1 ? "" : "s"} captured.`,
        )
      })

      const result = await step.do(
        "write answer",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        async () => writeResult(this.env.AI, this.env.HQBOT_MODEL_ID, prompt, research.sources),
      )

      let replyMessageId: string | null = null
      if (input.source === "email" && this.env.HQBOT_AUTO_REPLY === "true") {
        await step.do("prepare reply", async () => {
          await agent.setStatus(input.taskId, "replying")
          await agent.addActivity(
            input.taskId,
            "replying",
            "Replying through HQBase",
            "The Bot checks the thread before the non-idempotent send.",
          )
        })
        replyMessageId = await step.do(
          "send one reply",
          { retries: { limit: 3, delay: "8 seconds", backoff: "linear" }, timeout: "2 minutes" },
          async () => {
            const messageId = required(input.messageId, "messageId")
            const config = mailConfig(this.env)
            const inbound = await getMessage(config, messageId)
            const duplicate = existingReply(
              await getThread(config, messageId),
              inbound,
              config.mailboxAddress,
            )
            if (duplicate) return duplicate.id
            return (await replyToMessage(config, messageId, result)).id
          },
        )
      }

      await step.do("complete task", async () => {
        await agent.completeTask(input.taskId, result, replyMessageId)
      })
      return { taskId: input.taskId }
    } catch (error) {
      await step.do("record task failure", async () => {
        await agent.failTask(input.taskId, errorMessage(error))
      })
      return { taskId: input.taskId }
    }
  }
}
