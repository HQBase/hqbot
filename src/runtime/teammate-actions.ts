import { action } from "@cloudflare/think";
import { z } from "zod";

import { executeApprovedReply } from "./approval";
import { delegateToNamedTeammates, MAX_DELEGATED_TASK_CHARS } from "./collaboration";
import { latestUserText } from "./routing";
import type { DelegatedTaskResult, WorkspaceAgentRpc, WorkspaceTeammateDto } from "./types";

export const REPLY_PERMISSION = "hqbase:reply";

interface TeammateActionDependencies {
  botId: string;
  workspaceAgent: WorkspaceAgentRpc;
  delegate(target: WorkspaceTeammateDto, task: string): Promise<DelegatedTaskResult>;
}

export function createTeammateActions(dependencies: TeammateActionDependencies) {
  return {
    delegate_to_teammates: action({
      description:
        "Delegate one bounded, read-only subtask to the existing teammates named with @Name in the user's current request. Then synthesize their reports.",
      inputSchema: z.object({
        task: z.string().trim().min(1).max(MAX_DELEGATED_TASK_CHARS)
      }),
      kind: "server",
      timeoutMs: 100_000,
      execute: ({ task }, ctx) =>
        delegateToNamedTeammates({
          prompt: latestUserText(ctx.messages),
          task,
          currentBotId: dependencies.botId,
          listBots: () => dependencies.workspaceAgent.listBots(),
          delegate: dependencies.delegate
        })
    }),
    send_hqbase_reply: action({
      description: "Submit the final draft as a reply through the connected HQBase mailbox.",
      inputSchema: z.object({
        taskId: z.string().min(1).max(200),
        draft: z.string().min(1).max(100_000)
      }),
      kind: "durable-pause",
      approval: true,
      approvalSummary: "Send this HQBase reply",
      approvalRisk: "high",
      permissions: [REPLY_PERMISSION],
      idempotencyKey: ({ input }) => `hqbase-reply:${dependencies.botId}:${input.taskId}`,
      timeoutMs: 60_000,
      execute: ({ taskId, draft }) =>
        executeApprovedReply({
          taskId,
          recordDecision: (approvedTaskId) =>
            dependencies.workspaceAgent.recordReplyDecision(approvedTaskId, true),
          send: () =>
            dependencies.workspaceAgent.sendApprovedReply({
              botId: dependencies.botId,
              taskId,
              draft
            })
        })
    })
  };
}
