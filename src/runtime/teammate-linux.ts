import type { ToolSet } from "ai";

import type { TeammateComputer } from "./computer";
import {
  createLinuxBashTool,
  type LinuxProcessResult,
  type ResumeLinuxProcessInput,
  type StartLinuxProcessInput
} from "./linux-shell";
import type { WorkspaceAgentRpc } from "./types";

export function createTeammateLinuxTool(
  env: Env,
  botId: string,
  workspaceAgent: WorkspaceAgentRpc,
  taskId: () => unknown,
  computer: TeammateComputer,
  startProcess?: (input: StartLinuxProcessInput) => Promise<LinuxProcessResult>,
  resumeProcess?: (input: ResumeLinuxProcessInput) => Promise<LinuxProcessResult | null>
): ToolSet[string] {
  return createLinuxBashTool({
    acquireSandbox: async (toolCallId) => {
      const currentTaskId = taskId();
      await computer.assertModelControlAvailable();
      await computer.open({
        eventId: `bash:${toolCallId}`,
        taskId: typeof currentTaskId === "string" ? currentTaskId : null
      });
      return computer.sandbox();
    },
    beforeExec: () => computer.assertModelControlAvailable(),
    botId,
    bucket: env.ARTIFACTS,
    catalog: workspaceAgent,
    resumeProcess,
    sandbox: () => computer.sandbox(),
    startProcess,
    stopSandbox: (checkpoint) => computer.stop(checkpoint)
  });
}
