import type { ProcessStatus } from "@cloudflare/sandbox";
import { describe, expect, it, vi } from "vitest";

import { ManagedLinuxProcessSupervisor } from "../../src/runtime/managed-linux-process";
import { PROCESS_POLL_INTERVAL_MS } from "../../src/runtime/managed-linux-start";
import type { ActiveWork, ManagedLinuxProcess } from "../../src/runtime/work";

function work(state: ActiveWork["state"]): ActiveWork {
  return {
    taskId: "task-1",
    goal: "Run a report",
    checkpoint: "The command is running",
    state,
    generation: state === "cancelled" ? 2 : 1,
    wakeAt: null,
    scheduleId: null,
    submissionId: null,
    lastError: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:01:00.000Z"
  };
}

function process(): ManagedLinuxProcess {
  return {
    processId: "process-1",
    taskId: "task-1",
    generation: 1,
    state: "running",
    runRoot: "/workspace/hqbot/runs/run-1",
    outputRoot: "/workspace/hqbot/runs/run-1/output",
    scriptPath: "/workspace/hqbot/runs/run-1/command.sh",
    staged: [],
    outputs: [],
    failureCount: 0,
    pollScheduleId: "poll-1",
    pollToken: 1,
    startedAt: "2026-09-01T12:00:00.000Z",
    deadlineAt: "2099-09-02T12:00:00.000Z",
    result: null,
    updatedAt: "2026-09-01T12:00:00.000Z"
  };
}

function serialTasks(state: { work: ActiveWork }) {
  let tail: Promise<void> = Promise.resolve();
  return {
    active: () => state.work,
    current: () => state.work,
    run: <T>(operation: () => Promise<T>) => {
      const result = tail.then(operation, operation);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    continueFrom: async (current: ActiveWork, checkpoint: string) => {
      state.work = {
        ...current,
        checkpoint,
        generation: current.generation + 1,
        state: "scheduled",
        updatedAt: new Date().toISOString()
      };
      return state.work;
    },
    syncProjection: vi.fn(async () => undefined),
    transition: (_current: ActiveWork | null, next: ActiveWork) => {
      state.work = next;
      return next;
    }
  };
}

function processStore(state: { process: ManagedLinuxProcess }) {
  return {
    active: () =>
      ["completed", "failed", "cancelled"].includes(state.process.state) ? null : state.process,
    current: () => state.process,
    put: (next: ManagedLinuxProcess) => {
      state.process = next;
      return next;
    }
  };
}

function startHarness(input: {
  processLookupError?: Error;
  processStatus?: ProcessStatus;
  startError?: Error;
}) {
  const state: { process: ManagedLinuxProcess | null; work: ActiveWork | null } = {
    process: null,
    work: null
  };
  let tail: Promise<void> = Promise.resolve();
  const syncProjection = vi.fn(async () => undefined);
  const tasks = {
    active: () => {
      const current = state.work;
      return current && !["done", "failed", "cancelled"].includes(current.state) ? current : null;
    },
    current: () => state.work,
    run: <T>(operation: () => Promise<T>) => {
      const result = tail.then(operation, operation);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    continueFrom: async (current: ActiveWork, checkpoint: string) => {
      const next: ActiveWork = {
        ...current,
        checkpoint,
        generation: current.generation + 1,
        state: "scheduled",
        updatedAt: new Date().toISOString()
      };
      state.work = next;
      return next;
    },
    syncProjection,
    transition: (expected: ActiveWork | null, next: ActiveWork) => {
      if (state.work !== expected) return null;
      state.work = next;
      return next;
    }
  };
  const store = {
    active: () => {
      const current = state.process;
      return current && !["completed", "failed", "cancelled"].includes(current.state)
        ? current
        : null;
    },
    current: () => state.process,
    put: (next: ManagedLinuxProcess) => {
      state.process = next;
      return next;
    }
  };
  const processStatus = input.processStatus ?? "running";
  const process = {
    command: "sleep 10",
    exitCode: processStatus === "completed" ? 0 : undefined,
    id: "process-1",
    startTime: new Date(),
    status: processStatus,
    getStatus: vi.fn(async () => processStatus),
    kill: vi.fn(async () => undefined),
    waitForExit: vi.fn(async () => ({ exitCode: 0 }))
  };
  const startProcess = input.startError
    ? vi.fn(async () => {
        throw input.startError;
      })
    : vi.fn(async () => process);
  const sandbox = {
    exec: vi.fn(async () => ({ exitCode: 0 })),
    getProcess: vi.fn(async () => {
      if (input.processLookupError) throw input.processLookupError;
      return process;
    }),
    getProcessLogs: vi.fn(async () => ({ stderr: "", stdout: "done\n" })),
    killProcess: vi.fn(async () => undefined),
    startProcess
  };
  const cancelSchedule = vi.fn(async () => true);
  let scheduleNumber = 0;
  const schedulePoll = vi.fn(async () => ({ id: `poll-${++scheduleNumber}` }));
  const supervisor = new ManagedLinuxProcessSupervisor({
    addAssistantMessage: vi.fn(),
    botId: "bot-1",
    bucket: {} as Env["ARTIFACTS"],
    cancelSchedule,
    computer: () =>
      ({ acquire: vi.fn(async () => sandbox), sandbox: () => sandbox, stop: vi.fn() }) as never,
    inlineWaitMs: 5,
    isActiveTaskTurn: () => false,
    markInteraction: vi.fn(),
    processStore: store as never,
    schedulePoll,
    tasks: tasks as never,
    transactionSync: (closure) => closure(),
    workspaceAgent: {} as never
  });
  const run = {
    outputRoot: "/workspace/hqbot/output",
    outputs: [],
    runRoot: "/workspace/hqbot/runs/run-1",
    scriptPath: "/workspace/hqbot/runs/run-1/command.sh",
    staged: []
  };
  const startInput = {
    fingerprint: '{"script":"sleep 10"}',
    run,
    toolCallId: "tool-call-1"
  };
  return {
    cancelSchedule,
    process,
    sandbox,
    schedulePoll,
    startInput,
    state,
    supervisor,
    syncProjection
  };
}

describe("managed Linux process", () => {
  it("checks a handed-off command again within five seconds", () => {
    expect(PROCESS_POLL_INTERVAL_MS).toBe(5_000);
  });

  it("saves durable ownership before one quick command starts", async () => {
    const runtime = startHarness({ processStatus: "completed" });

    await expect(runtime.supervisor.start(runtime.startInput)).resolves.toEqual({
      durationMs: expect.any(Number),
      exitCode: 0,
      files: [],
      stderr: "",
      stdout: "done\n",
      type: "sandbox_command"
    });

    expect(runtime.schedulePoll.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.sandbox.startProcess.mock.invocationCallOrder[0] ?? 0
    );
    expect(runtime.state.process).toMatchObject({
      processId: expect.stringMatching(/^hqbot-tool-[a-f0-9]{32}$/u),
      state: "completed"
    });
    expect(runtime.state.work?.state).toBe("done");
    expect(runtime.syncProjection).not.toHaveBeenCalled();
    expect(runtime.cancelSchedule).toHaveBeenCalledWith("poll-1");
    expect(runtime.process.waitForExit).not.toHaveBeenCalled();

    await expect(runtime.supervisor.start(runtime.startInput)).resolves.toMatchObject({
      type: "sandbox_command"
    });
    expect(runtime.sandbox.startProcess).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    new Error("Connection closed: Durable Object is no longer active")
  ])("hands a slow or disconnected command to its durable schedule", async (processLookupError) => {
    const runtime = startHarness({ processLookupError });

    const first = await runtime.supervisor.start(runtime.startInput);
    const replay = await runtime.supervisor.start(runtime.startInput);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({ state: "running", type: "sandbox_process" });
    expect(runtime.state.work?.state).toBe("waiting");
    expect(runtime.syncProjection).toHaveBeenCalledTimes(2);
    expect(runtime.sandbox.startProcess).toHaveBeenCalledOnce();
    expect(runtime.process.waitForExit).not.toHaveBeenCalled();
    expect(runtime.schedulePoll).toHaveBeenCalledOnce();
  });

  it("lets a later turn request durable process cancellation", async () => {
    const runtime = startHarness({ processStatus: "running" });
    const handoff = await runtime.supervisor.start(runtime.startInput);
    if (handoff.type !== "sandbox_process") throw new Error("The process did not hand off");

    await expect(runtime.supervisor.stop(handoff.processId)).resolves.toEqual({
      processId: handoff.processId,
      state: "cancelling"
    });

    expect(runtime.state.process?.state).toBe("cancelling");
    expect(runtime.state.work?.state).toBe("cancelled");
    expect(runtime.syncProjection).toHaveBeenCalled();
    expect(runtime.process.kill).not.toHaveBeenCalled();
  });

  it("recovers an unknown Sandbox start without starting a second copy", async () => {
    const runtime = startHarness({
      startError: new Error("Connection closed: Durable Object is no longer active")
    });

    await expect(runtime.supervisor.start(runtime.startInput)).resolves.toMatchObject({
      state: "running",
      type: "sandbox_process"
    });
    await expect(runtime.supervisor.resume(runtime.startInput)).resolves.toMatchObject({
      type: "sandbox_process"
    });

    expect(runtime.state.process?.state).toBe("preparing");
    expect(runtime.state.work?.state).toBe("waiting");
    expect(runtime.sandbox.startProcess).toHaveBeenCalledOnce();
    expect(runtime.sandbox.exec).not.toHaveBeenCalled();
  });

  it("continues after eviction between saving a result and scheduling the next turn", async () => {
    const processState = {
      process: {
        ...process(),
        state: "completed" as const,
        result: {
          durationMs: 10,
          exitCode: 0,
          files: [],
          stderr: "",
          stdout: "done\n"
        }
      }
    };
    const workState = { work: work("waiting") };
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage: vi.fn(),
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule: vi.fn(async () => true),
      computer: () => ({ sandbox: () => ({}) }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(),
      processStore: processStore(processState) as never,
      schedulePoll: vi.fn(async () => ({ id: "poll-2" })),
      tasks: serialTasks(workState) as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: {} as never
    });

    await supervisor.reconcile();

    expect(workState.work).toMatchObject({
      checkpoint: expect.stringContaining("finished with exit code 0"),
      generation: 2,
      state: "scheduled"
    });
  });

  it("makes Stop durable before scheduled Sandbox cleanup", async () => {
    const processState = { process: process() };
    const workState = { work: work("running") };
    const killed = vi.fn(async () => undefined);
    const sandbox = {
      exec: vi.fn(async () => ({ exitCode: 0 })),
      getProcess: vi.fn(async () => ({ kill: killed }))
    };
    const stopComputer = vi.fn(async () => undefined);
    let cancellationPayload: Parameters<ManagedLinuxProcessSupervisor["poll"]>[0] | null = null;
    let scheduleNumber = 1;
    const cancelSchedule = vi.fn(async () => true);
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage: vi.fn(),
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule,
      computer: () => ({ sandbox: () => sandbox, stop: stopComputer }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(),
      processStore: processStore(processState) as never,
      schedulePoll: vi.fn(async (_when, payload) => {
        cancellationPayload = payload;
        return { id: `poll-${++scheduleNumber}` };
      }),
      tasks: serialTasks(workState) as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: {} as never
    });

    await expect(supervisor.cancelWork(workState.work, work("cancelled"))).resolves.toMatchObject({
      state: "cancelled"
    });

    expect(processState.process).toMatchObject({
      pollScheduleId: "poll-2",
      pollToken: 2,
      state: "cancelling"
    });
    expect(sandbox.getProcess).not.toHaveBeenCalled();
    expect(killed).not.toHaveBeenCalled();
    expect(cancellationPayload).not.toBeNull();

    await supervisor.poll(cancellationPayload as never);

    expect(killed).toHaveBeenCalledWith("SIGTERM");
    expect(sandbox.exec).toHaveBeenCalledOnce();
    expect(processState.process.state).toBe("cancelled");
    expect(cancelSchedule).toHaveBeenCalledWith("poll-1");
    expect(cancelSchedule).toHaveBeenCalledWith("poll-2");
    expect(stopComputer).toHaveBeenCalledOnce();
  });

  it("keeps an uncertain command exclusive until Stop schedules its cleanup", async () => {
    const processState = { process: { ...process(), state: "uncertain" as const } };
    const workState = { work: work("running") };
    const schedulePoll = vi.fn(async () => ({ id: "poll-2" }));
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage: vi.fn(),
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule: vi.fn(async () => true),
      computer: () => ({ sandbox: () => ({}) }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(),
      processStore: processStore(processState) as never,
      schedulePoll,
      tasks: serialTasks(workState) as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: {} as never
    });

    await expect(supervisor.start({} as never)).rejects.toThrow(
      "A Bash process is already running"
    );
    await supervisor.cancelWork(workState.work, work("cancelled"));

    expect(processState.process.state).toBe("cancelling");
    expect(schedulePoll).toHaveBeenCalledOnce();
  });

  it("reschedules cancellation when Sandbox process lookup fails", async () => {
    const processState = { process: { ...process(), state: "cancelling" as const } };
    const workState = { work: work("cancelled") };
    const schedulePoll = vi.fn(async () => ({ id: "poll-2" }));
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage: vi.fn(),
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule: vi.fn(async () => true),
      computer: () =>
        ({
          sandbox: () => ({
            getProcess: vi.fn(async () => {
              throw new Error("Sandbox unavailable");
            })
          })
        }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(),
      processStore: processStore(processState) as never,
      schedulePoll,
      tasks: serialTasks(workState) as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: {} as never
    });

    await supervisor.poll({
      generation: 1,
      processId: "process-1",
      taskId: "task-1",
      token: 1
    });

    expect(processState.process).toMatchObject({ pollToken: 2, state: "cancelling" });
    expect(schedulePoll).toHaveBeenCalledOnce();
  });

  it("stops the computer when temporary-file cleanup fails", async () => {
    const processState = { process: { ...process(), state: "cancelling" as const } };
    const workState = { work: work("cancelled") };
    const killed = vi.fn(async () => undefined);
    const stopComputer = vi.fn(async () => undefined);
    const sandbox = {
      exec: vi.fn(async () => ({ exitCode: 1 })),
      getProcess: vi.fn(async () => ({ kill: killed }))
    };
    const cancelSchedule = vi.fn(async () => true);
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage: vi.fn(),
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule,
      computer: () => ({ sandbox: () => sandbox, stop: stopComputer }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(),
      processStore: processStore(processState) as never,
      schedulePoll: vi.fn(async () => ({ id: "poll-2" })),
      tasks: serialTasks(workState) as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: {} as never
    });

    await supervisor.poll({
      generation: 1,
      processId: "process-1",
      taskId: "task-1",
      token: 1
    });

    expect(killed).toHaveBeenCalledWith("SIGTERM");
    expect(processState.process.state).toBe("cancelled");
    expect(cancelSchedule).toHaveBeenCalledWith("poll-1");
    expect(stopComputer).toHaveBeenCalledOnce();
  });

  it("does not hold the task queue while Sandbox status is pending", async () => {
    const processState = { process: process() };
    const workState = { work: work("waiting") };
    let releaseAcquire!: (sandbox: unknown) => void;
    const pendingAcquire = new Promise((resolve) => {
      releaseAcquire = resolve;
    });
    const acquire = vi.fn(() => pendingAcquire);
    const tasks = serialTasks(workState);
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage: vi.fn(),
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule: vi.fn(async () => true),
      computer: () => ({ acquire }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(),
      processStore: processStore(processState) as never,
      schedulePoll: vi.fn(async () => ({ id: "poll-2" })),
      tasks: tasks as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: {} as never
    });

    const polling = supervisor.poll({
      generation: 1,
      processId: "process-1",
      taskId: "task-1",
      token: 1
    });
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());

    await expect(tasks.run(async () => "queue is free")).resolves.toBe("queue is free");

    releaseAcquire({
      getProcess: vi.fn(async () => ({ getStatus: vi.fn(async () => "running") }))
    });
    await polling;
  });

  it("times out a stuck status check and schedules another poll", async () => {
    const processState = { process: process() };
    const workState = { work: work("waiting") };
    const schedulePoll = vi.fn(async () => ({ id: "poll-2" }));
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage: vi.fn(),
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule: vi.fn(async () => true),
      computer: () =>
        ({
          acquire: vi.fn(async () => ({
            getProcess: vi.fn(async () => ({
              getStatus: vi.fn(() => new Promise(() => undefined))
            }))
          }))
        }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(),
      pollTimeoutMs: 5,
      processStore: processStore(processState) as never,
      schedulePoll,
      tasks: serialTasks(workState) as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: {} as never
    });

    await supervisor.poll({
      generation: 1,
      processId: "process-1",
      taskId: "task-1",
      token: 1
    });

    expect(processState.process).toMatchObject({ failureCount: 1, pollToken: 2 });
    expect(schedulePoll).toHaveBeenCalledOnce();
  });

  it("keeps retrying transient Sandbox failures until the command deadline", async () => {
    const processState = { process: process() };
    const workState = { work: work("waiting") };
    let scheduleNumber = 1;
    const addAssistantMessage = vi.fn(async () => undefined);
    const tasks = serialTasks(workState);
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage,
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule: vi.fn(async () => true),
      computer: () =>
        ({
          acquire: vi.fn(async () => {
            throw new Error("Sandbox unavailable");
          })
        }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(async () => undefined),
      processStore: processStore(processState) as never,
      schedulePoll: vi.fn(async () => ({ id: `poll-${++scheduleNumber}` })),
      tasks: tasks as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: {} as never
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await supervisor.poll({
        generation: processState.process.generation,
        processId: processState.process.processId,
        taskId: processState.process.taskId,
        token: processState.process.pollToken
      });
    }

    expect(processState.process).toMatchObject({ failureCount: 8, state: "running" });
    expect(workState.work.state).toBe("waiting");
    expect(addAssistantMessage).not.toHaveBeenCalled();
  });

  it("marks an unverifiable command uncertain only after its deadline", async () => {
    const processState = {
      process: { ...process(), deadlineAt: "2026-09-01T12:30:00.000Z" }
    };
    const workState = { work: work("waiting") };
    const schedulePoll = vi.fn(async () => ({ id: "poll-2" }));
    const addAssistantMessage = vi.fn(async () => undefined);
    const scheduleRecovery = vi.fn(async () => undefined);
    const tasks = serialTasks(workState);
    tasks.syncProjection.mockRejectedValueOnce(new Error("Workspace unavailable"));
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage,
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule: vi.fn(async () => true),
      computer: () =>
        ({
          acquire: vi.fn(async () => ({
            getProcess: vi.fn(async () => null),
            listFiles: vi.fn(async () => ({ files: [] }))
          }))
        }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(async () => undefined),
      processStore: processStore(processState) as never,
      schedulePoll,
      scheduleRecovery,
      tasks: tasks as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: {} as never
    });

    await supervisor.poll({
      generation: processState.process.generation,
      processId: processState.process.processId,
      taskId: processState.process.taskId,
      token: processState.process.pollToken
    });

    expect(processState.process.state).toBe("uncertain");
    expect(workState.work.state).toBe("uncertain");
    expect(addAssistantMessage).toHaveBeenCalledOnce();
    expect(workState.work.lastError).toContain("The Sandbox process was not found");
    expect(schedulePoll).not.toHaveBeenCalled();
    expect(scheduleRecovery).toHaveBeenCalledOnce();
  });

  it("recovers a completed command when its Sandbox process handle is gone", async () => {
    const processState = { process: process() };
    const workState = { work: work("waiting") };
    const resultPath = `${processState.process.runRoot}/result.json`;
    const completion = JSON.stringify({
      durationMs: 12,
      exitCode: 0,
      stderr: "",
      stdout: "done from record\n"
    });
    const sandbox = {
      exec: vi.fn(async () => ({ exitCode: 0 })),
      getProcess: vi.fn(async () => null),
      listFiles: vi.fn(async () => ({
        files: [{ absolutePath: resultPath, size: completion.length, type: "file" as const }]
      })),
      readFile: vi.fn(async () => ({
        content: new Blob([completion]).stream(),
        mimeType: "application/json",
        size: completion.length
      }))
    };
    const addAssistantMessage = vi.fn(async () => undefined);
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage,
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule: vi.fn(async () => true),
      computer: () => ({ acquire: vi.fn(async () => sandbox), sandbox: () => sandbox }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(async () => undefined),
      processStore: processStore(processState) as never,
      schedulePoll: vi.fn(async () => ({ id: "poll-2" })),
      tasks: serialTasks(workState) as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: {} as never
    });

    await supervisor.poll({
      generation: 1,
      processId: "process-1",
      taskId: "task-1",
      token: 1
    });

    expect(processState.process).toMatchObject({
      result: { exitCode: 0, stdout: "done from record\n" },
      state: "completed"
    });
    expect(workState.work).toMatchObject({
      checkpoint: expect.stringContaining("done from record"),
      state: "scheduled"
    });
    expect(addAssistantMessage).not.toHaveBeenCalled();
  });

  it("reports a missing declared output as a known command failure", async () => {
    const processState = {
      process: {
        ...process(),
        outputs: [
          {
            absolutePath: "/workspace/hqbot/runs/run-1/output/report.pdf",
            fileId: "file-1",
            name: "report.pdf",
            relativePath: "report.pdf"
          }
        ]
      }
    };
    const workState = { work: work("waiting") };
    const sandbox = {
      exec: vi.fn(async () => ({ exitCode: 0 })),
      getProcess: vi.fn(async () => ({
        exitCode: 0,
        getStatus: vi.fn(async () => "completed" as const)
      })),
      getProcessLogs: vi.fn(async () => ({ stderr: "", stdout: "checked\n" })),
      listFiles: vi.fn(async () => ({ files: [] }))
    };
    const supervisor = new ManagedLinuxProcessSupervisor({
      addAssistantMessage: vi.fn(async () => undefined),
      botId: "bot-1",
      bucket: {} as Env["ARTIFACTS"],
      cancelSchedule: vi.fn(async () => true),
      computer: () => ({ acquire: vi.fn(async () => sandbox), sandbox: () => sandbox }) as never,
      isActiveTaskTurn: () => false,
      markInteraction: vi.fn(async () => undefined),
      processStore: processStore(processState) as never,
      schedulePoll: vi.fn(async () => ({ id: "poll-2" })),
      tasks: serialTasks(workState) as never,
      transactionSync: (closure) => closure(),
      workspaceAgent: { getFile: vi.fn(async () => null) } as never
    });

    await supervisor.poll({
      generation: 1,
      processId: "process-1",
      taskId: "task-1",
      token: 1
    });

    expect(processState.process).toMatchObject({
      result: {
        exitCode: 1,
        stderr: "HQBot could not save the declared output: Output file report.pdf was not created"
      },
      state: "failed"
    });
    expect(workState.work).toMatchObject({
      checkpoint: expect.stringContaining("Output file report.pdf was not created"),
      state: "scheduled"
    });
  });
});
