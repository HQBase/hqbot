import { action } from "@cloudflare/think";
import { z } from "zod";

import { delegateToNamedTeammates, MAX_DELEGATED_TASK_CHARS } from "./collaboration";
import { latestUserText } from "./routing";
import type { DelegatedTaskResult, WorkspaceAgentRpc, WorkspaceTeammateDto } from "./types";

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
    })
  };
}
