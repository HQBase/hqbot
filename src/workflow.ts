import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { getAgentByName } from "agents"

import type { HQBotAgent } from "./agent"
import { needsReplyApproval } from "./domain/approval"
import type { ResearchPlan, ResearchResult, WorkflowInput } from "./domain/types"
import { planResearch, writeResult, writeSpecialistNote } from "./services/ai"
import { researchWithBrowser } from "./services/browser"
import { decryptConnectionToken, decryptSecret } from "./services/crypto"
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
      let config: MailConfig | null = null
      if (input.connectionId) {
        const connection = await agent.getBotConnection(input.connectionId)
        if (!connection || connection.botId !== input.botId) {
          throw new Error("The HQBase connection is not available")
        }
        config = {
          origin: connection.origin,
          mailboxId: connection.mailboxId,
          mailboxAddress: connection.mailboxAddress,
          token: await decryptConnectionToken(
            this.env.HQBOT_CONNECTION_KEY,
            connection.tokenCiphertext,
            connection.tokenIv,
          ),
        }
      }

      const rawPrompt = await step.do("read request", async () => {
        if (input.source === "chat") return required(input.prompt, "prompt")
        const messageId = required(input.messageId, "messageId")
        if (!config) throw new Error("The email task has no HQBase connection")
        const message = await getMessage(config, messageId)
        const request = [`Subject: ${message.subject}`, message.textBody || message.snippet]
          .filter(Boolean)
          .join("\n\n")
        await agent.setTaskInput(input.taskId, request, message.subject, message.fromAddress)
        return request
      })

      const memories = await step.do("load teammate memory", async () =>
        agent.listMemories(input.botId),
      )
      const skill = input.skillId
        ? await step.do("load skill", async () => agent.getSkill(input.skillId ?? "", input.botId))
        : null
      const rememberedPrompt = memories.length
        ? `${rawPrompt}\n\nTeammate memory:\n${memories.map((memory) => `- ${memory.content}`).join("\n")}`
        : rawPrompt
      const prompt = skill
        ? `${rememberedPrompt}\n\nSelected skill: ${skill.name}\n${skill.instructions}`
        : rememberedPrompt

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
        async () =>
          planResearch(
            this.env.AI,
            this.env.HQBOT_MODEL_ID,
            this.env.HQBOT_FALLBACK_MODEL_ID,
            prompt,
          ),
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
        async () => {
          const computer = await agent.getComputerState()
          const cookies =
            computer.cookiesCiphertext && computer.cookiesIv
              ? await decryptSecret(
                  this.env.HQBOT_CONNECTION_KEY,
                  computer.cookiesCiphertext,
                  computer.cookiesIv,
                )
              : undefined
          return researchWithBrowser(
            this.env.BROWSER,
            this.env.ARTIFACTS,
            input.taskId,
            plan,
            cookies,
          )
        },
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

      const collaborators = input.collaboratorIds?.length
        ? await step.do("load collaborators", async () => {
            const ids = new Set(input.collaboratorIds)
            return (await agent.listBots()).filter((candidate) => ids.has(candidate.id))
          })
        : []

      const specialistNotes: string[] = []
      for (const teammate of collaborators) {
        const note = await step.do(
          `consult ${teammate.id}`,
          { retries: { limit: 2, delay: "5 seconds", backoff: "linear" }, timeout: "2 minutes" },
          async () =>
            writeSpecialistNote(
              this.env.AI,
              this.env.HQBOT_MODEL_ID,
              this.env.HQBOT_FALLBACK_MODEL_ID,
              prompt,
              research.sources,
              teammate,
            ),
        )
        specialistNotes.push(`${teammate.name} (${teammate.title}):\n${note}`)
      }

      if (collaborators.length > 0) {
        await step.do("show collaboration", async () => {
          await agent.addActivity(
            input.taskId,
            "collaboration",
            "Teammates consulted",
            collaborators.map((candidate) => candidate.name).join(", "),
          )
        })
      }

      const teamPrompt = specialistNotes.length
        ? `${prompt}\n\nSPECIALIST NOTES\n${specialistNotes.join("\n\n")}`
        : prompt

      const result = await step.do(
        "write answer",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        async () =>
          writeResult(
            this.env.AI,
            this.env.HQBOT_MODEL_ID,
            this.env.HQBOT_FALLBACK_MODEL_ID,
            teamPrompt,
            research.sources,
          ),
      )

      let replyMessageId: string | null = null
      let sendReply = input.source === "email"
      if (needsReplyApproval(input.source, this.env.HQBOT_AUTO_REPLY === "true")) {
        await step.do("request reply approval", async () => {
          await agent.requestReplyApproval(input.taskId, result)
        })
        const decision = await step.waitForEvent<{ approved: boolean }>("wait for reply approval", {
          type: "approval",
          timeout: "7 days",
        })
        sendReply = decision.payload.approved
        await step.do("record reply decision", async () => {
          await agent.recordReplyDecision(input.taskId, sendReply)
        })
      }

      if (sendReply) {
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
            if (!config) throw new Error("The email task has no HQBase connection")
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
