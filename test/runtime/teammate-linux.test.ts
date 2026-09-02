import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";

import type { TeammateComputer } from "../../src/runtime/computer";
import { createTeammateLinuxTool } from "../../src/runtime/teammate-linux";
import type { WorkspaceAgentRpc } from "../../src/runtime/types";

async function execute(
  tool: ToolSet[string],
  toolCallId: string,
  input: unknown = { script: "true" }
): Promise<unknown> {
  if (!tool.execute) throw new Error("Tool is not executable");
  return tool.execute(input, {
    abortSignal: undefined,
    context: undefined,
    messages: [],
    toolCallId
  });
}

describe("teammate Linux tool", () => {
  it("acquires the unified computer with a replay-stable event for each Bash call", async () => {
    const sandbox = {
      deleteFile: vi.fn(async () => ({ success: true })),
      exec: vi.fn(async () => ({ duration: 4, exitCode: 0, stderr: "", stdout: "" })),
      listFiles: vi.fn(async () => ({ files: [] })),
      mkdir: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => ({ success: true }))
    };
    const workspaceAgent = {} as WorkspaceAgentRpc;
    const env = {
      ARTIFACTS: {
        delete: vi.fn(),
        get: vi.fn(),
        put: vi.fn()
      },
      SANDBOX: {}
    } as unknown as Env;
    const open = vi.fn(async () => ({ webSocketPath: "/desktop/ws" }));
    const stop = vi.fn(async () => undefined);
    const assertModelControlAvailable = vi.fn(async () => undefined);
    const computer = {
      assertModelControlAvailable,
      open,
      sandbox: () => sandbox,
      stop
    } as unknown as TeammateComputer;
    const linux = createTeammateLinuxTool(env, "bot-1", workspaceAgent, () => "task-1", computer);

    await execute(linux, "call-1");
    await execute(linux, "call-2");

    expect(open).toHaveBeenNthCalledWith(1, {
      eventId: "bash:call-1",
      taskId: "task-1"
    });
    expect(open).toHaveBeenNthCalledWith(2, {
      eventId: "bash:call-2",
      taskId: "task-1"
    });
    expect(sandbox.exec).toHaveBeenCalledTimes(4);
    expect(assertModelControlAvailable).toHaveBeenCalledTimes(6);
  });

  it("uses the managed computer stop path when a Bash command fails to start", async () => {
    const sandbox = {
      deleteFile: vi.fn(async () => ({ success: true })),
      exec: vi
        .fn()
        .mockRejectedValueOnce(new Error("Command timed out"))
        .mockResolvedValueOnce({ duration: 1, exitCode: 0, stderr: "", stdout: "" }),
      listFiles: vi.fn(async () => ({ files: [] })),
      mkdir: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => ({ success: true }))
    };
    const stop = vi.fn(async () => undefined);
    const computer = {
      assertModelControlAvailable: vi.fn(async () => undefined),
      open: vi.fn(async () => ({ webSocketPath: "/desktop/ws" })),
      sandbox: () => sandbox,
      stop
    } as unknown as TeammateComputer;
    const linux = createTeammateLinuxTool(
      {
        ARTIFACTS: { delete: vi.fn(), get: vi.fn(), put: vi.fn() },
        SANDBOX: {}
      } as unknown as Env,
      "bot-1",
      {} as WorkspaceAgentRpc,
      () => null,
      computer
    );

    await expect(execute(linux, "call-1")).rejects.toThrow("Command timed out");

    expect(stop).toHaveBeenCalledWith(true);
    expect(sandbox.exec.mock.invocationCallOrder[1]).toBeLessThan(
      stop.mock.invocationCallOrder[0] ?? 0
    );
    expect(sandbox.stop).not.toHaveBeenCalled();
  });

  it("hands Bash to the durable supervisor without running it inline", async () => {
    const sandbox = {
      deleteFile: vi.fn(async () => ({ success: true })),
      exec: vi.fn(async () => ({ duration: 1, exitCode: 0, stderr: "", stdout: "" })),
      listFiles: vi.fn(async () => ({ files: [] })),
      mkdir: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => ({ success: true }))
    };
    const startProcess = vi.fn(async () => ({
      processId: "process-1",
      state: "running" as const,
      taskId: "task-1",
      type: "sandbox_process" as const
    }));
    const computer = {
      assertModelControlAvailable: vi.fn(async () => undefined),
      open: vi.fn(async () => ({ webSocketPath: "/desktop/ws" })),
      sandbox: () => sandbox,
      stop: vi.fn(async () => undefined)
    } as unknown as TeammateComputer;
    const linux = createTeammateLinuxTool(
      { ARTIFACTS: { get: vi.fn() } } as unknown as Env,
      "bot-1",
      {} as WorkspaceAgentRpc,
      () => "task-1",
      computer,
      startProcess
    );

    await expect(
      execute(linux, "call-1", {
        script: "sleep 120"
      })
    ).resolves.toMatchObject({ processId: "process-1", type: "sandbox_process" });

    expect(startProcess).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: "call-1" }));
    expect(sandbox.exec).not.toHaveBeenCalled();
  });

  it("does not start Bash while the owner controls the shared computer", async () => {
    const open = vi.fn(async () => ({ webSocketPath: "/desktop/ws" }));
    const computer = {
      assertModelControlAvailable: vi.fn(async () => {
        throw new Error("The owner is controlling this computer");
      }),
      open,
      sandbox: vi.fn()
    } as unknown as TeammateComputer;
    const linux = createTeammateLinuxTool(
      { ARTIFACTS: {} } as Env,
      "bot-1",
      {} as WorkspaceAgentRpc,
      () => null,
      computer
    );

    await expect(execute(linux, "call-1")).rejects.toThrow(
      "The owner is controlling this computer"
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("does not stop the owner's computer when control starts during Bash setup", async () => {
    const sandbox = {
      deleteFile: vi.fn(async () => ({ success: true })),
      exec: vi.fn(async () => ({ duration: 1, exitCode: 0, stderr: "", stdout: "" })),
      listFiles: vi.fn(async () => ({ files: [] })),
      mkdir: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => ({ success: true }))
    };
    const stop = vi.fn(async () => undefined);
    const assertModelControlAvailable = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("The owner is controlling this computer"));
    const computer = {
      assertModelControlAvailable,
      open: vi.fn(async () => ({ webSocketPath: "/desktop/ws" })),
      sandbox: () => sandbox,
      stop
    } as unknown as TeammateComputer;
    const linux = createTeammateLinuxTool(
      { ARTIFACTS: {} } as Env,
      "bot-1",
      {} as WorkspaceAgentRpc,
      () => null,
      computer
    );

    await expect(execute(linux, "call-1")).rejects.toThrow(
      "The owner is controlling this computer"
    );

    expect(sandbox.exec).not.toHaveBeenCalledWith(
      "/usr/local/bin/hqbot-run-agent-command",
      expect.anything()
    );
    expect(stop).not.toHaveBeenCalled();
    expect(sandbox.stop).not.toHaveBeenCalled();
  });
});
