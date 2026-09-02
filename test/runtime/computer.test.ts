import { getSandbox } from "@cloudflare/sandbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeammateComputer } from "../../src/runtime/computer";
import type {
  ComputerControlPayload,
  ComputerLeasePayload,
  ComputerStorage
} from "../../src/runtime/computer-types";
import { COMPUTER_CHECKPOINT_KEY } from "../../src/runtime/desktop";
import type { WorkspaceAgentRpc } from "../../src/runtime/types";

vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));

class MemoryStorage {
  readonly data = new Map<string, unknown>();

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.data.get(key) as T | undefined);
  }

  put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  delete(keys: string | string[]): Promise<boolean> {
    const deleted = (Array.isArray(keys) ? keys : [keys]).map((key) => this.data.delete(key));
    return Promise.resolve(deleted.some(Boolean));
  }
}

function harness(hasManagedProcess?: () => boolean) {
  let schedule = 0;
  const storage = new MemoryStorage();
  const desktopProcess = {
    getStatus: vi.fn().mockResolvedValue("running"),
    waitForPort: vi.fn().mockResolvedValue(undefined)
  };
  const sandbox = {
    cleanupCompletedProcesses: vi.fn().mockResolvedValue(0),
    deleteFile: vi.fn().mockResolvedValue({ success: true }),
    exec: vi.fn(async (command: string) => ({
      duration: 1,
      exitCode: 0,
      stderr: "",
      stdout: command.includes("hqbot-computer-resources")
        ? JSON.stringify({
            cpuPercent: 10,
            memoryBytes: 20,
            memoryLimitBytes: 100,
            diskBytes: 30,
            diskLimitBytes: 200
          })
        : ""
    })),
    exists: vi.fn().mockResolvedValue({ exists: true }),
    getProcess: vi.fn().mockResolvedValue(desktopProcess),
    readFile: vi.fn().mockResolvedValue({
      content: new Blob(["checkpoint"]).stream(),
      mimeType: "application/gzip",
      size: 10
    }),
    setKeepAlive: vi.fn().mockResolvedValue(undefined),
    startProcess: vi.fn().mockResolvedValue(desktopProcess),
    stop: vi.fn().mockResolvedValue(undefined)
  };
  vi.mocked(getSandbox).mockReturnValue(sandbox as never);
  const artifacts = {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined)
  };
  const recordResourceUsage = vi.fn().mockResolvedValue(undefined);
  const checkSpendPolicy = vi.fn().mockResolvedValue({ allowed: true, reason: null });
  const scheduleSleep = vi.fn(async (_when: Date, _payload: ComputerLeasePayload) => ({
    id: `schedule-${++schedule}`
  }));
  const scheduleControl = vi.fn(async (_when: Date, _payload: ComputerControlPayload) => ({
    id: `schedule-${++schedule}`
  }));
  const cancelSchedule = vi.fn().mockResolvedValue(true);
  const computer = new TeammateComputer({
    botId: "bot-1",
    env: { ARTIFACTS: artifacts, SANDBOX: {} } as unknown as Env,
    storage: storage as ComputerStorage,
    workspaceAgent: { checkSpendPolicy, recordResourceUsage } as unknown as WorkspaceAgentRpc,
    cancelSchedule,
    hasManagedProcess,
    scheduleControl,
    scheduleSleep
  });
  return {
    artifacts,
    cancelSchedule,
    checkSpendPolicy,
    computer,
    desktopProcess,
    recordResourceUsage,
    sandbox,
    scheduleControl,
    scheduleSleep,
    storage
  };
}

describe("teammate computer lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
    vi.mocked(getSandbox).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reserves only each added part of the managed idle window", async () => {
    const { computer, recordResourceUsage, scheduleSleep } = harness();
    const firstNow = Date.now();

    await computer.acquire({ eventId: "browser:call-1", taskId: "task-1" });

    expect(recordResourceUsage).toHaveBeenNthCalledWith(1, {
      eventId: `computer:bot-1:browser:call-1:${firstNow}:${firstNow + 1_800_000}`,
      botId: "bot-1",
      taskId: "task-1",
      service: "sandbox",
      units: 1_800,
      estimatedCostMicroUsd: 37_008
    });
    expect(scheduleSleep).toHaveBeenNthCalledWith(1, new Date(firstNow + 1_800_000), {
      token: expect.any(String)
    });

    await vi.advanceTimersByTimeAsync(600_000);
    const secondNow = Date.now();
    await computer.acquire({ eventId: "bash:call-2", taskId: "task-1" });

    expect(recordResourceUsage).toHaveBeenNthCalledWith(2, {
      eventId: `computer:bot-1:bash:call-2:${firstNow + 1_800_000}:${secondNow + 1_800_000}`,
      botId: "bot-1",
      taskId: "task-1",
      service: "sandbox",
      units: 600,
      estimatedCostMicroUsd: 12_336
    });
  });

  it("stops a prepared computer if its first cost reservation is blocked", async () => {
    const { checkSpendPolicy, computer, sandbox } = harness();
    vi.mocked(checkSpendPolicy).mockResolvedValueOnce({
      allowed: false,
      reason: "The teammate daily cost budget has been reached"
    });

    await expect(computer.acquire({ eventId: "bash:call-1", taskId: null })).rejects.toThrow(
      "The teammate daily cost budget has been reached"
    );

    expect(sandbox.stop).toHaveBeenCalledOnce();
    await expect(computer.status()).resolves.toMatchObject({ running: false });
  });

  it("stops and clears a computer when its R2 restore cannot start", async () => {
    const { artifacts, computer, sandbox } = harness();
    vi.mocked(sandbox.exists).mockResolvedValueOnce({ exists: false });
    vi.mocked(artifacts.get).mockRejectedValueOnce(new Error("R2 is unavailable"));

    await expect(computer.acquire({ eventId: "bash:call-1", taskId: null })).rejects.toThrow(
      "R2 is unavailable"
    );

    expect(sandbox.setKeepAlive).toHaveBeenLastCalledWith(false);
    expect(sandbox.stop).toHaveBeenCalledOnce();
    await expect(computer.status()).resolves.toMatchObject({ running: false });
  });

  it("blocks model tools until the durable owner-control schedule revokes native input", async () => {
    const { computer, sandbox, scheduleControl } = harness();

    await computer.acquire({ eventId: "desktop:open", taskId: null });
    await computer.setOwnerControl(true);
    await expect(computer.assertModelControlAvailable()).rejects.toThrow(
      "The owner is controlling this computer. Wait until they return control."
    );
    expect(sandbox.exec).toHaveBeenCalledWith(
      "pkill -TERM -f '[h]qbot-(browser|desktop)-control' || true",
      { timeout: 5_000 }
    );
    expect(sandbox.exec).toHaveBeenCalledWith("x11vnc -display :99 -sync -R noviewonly", {
      timeout: 5_000
    });
    const payload = vi.mocked(scheduleControl).mock.calls[0]?.[1];
    if (!payload) throw new Error("The owner-control lease was not scheduled");

    await vi.advanceTimersByTimeAsync(90_001);
    await computer.settleOwnerControl(payload);

    expect(sandbox.exec).toHaveBeenCalledWith("x11vnc -display :99 -sync -R viewonly", {
      timeout: 5_000
    });
    await expect(computer.assertModelControlAvailable()).resolves.toBeUndefined();
  });

  it("ignores a stale owner-control expiry after the agent renews the grant", async () => {
    const { computer, sandbox, scheduleControl } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });
    await computer.setOwnerControl(true);
    const stale = vi.mocked(scheduleControl).mock.calls[0]?.[1];
    if (!stale) throw new Error("The first owner-control lease was not scheduled");

    await vi.advanceTimersByTimeAsync(30_000);
    await computer.setOwnerControl(true);
    await vi.advanceTimersByTimeAsync(60_001);
    await computer.settleOwnerControl(stale);

    expect(
      vi
        .mocked(sandbox.exec)
        .mock.calls.filter(([command]) => String(command).includes("-R viewonly"))
    ).toHaveLength(0);
    await expect(computer.assertModelControlAvailable()).rejects.toThrow(
      "The owner is controlling this computer"
    );
  });

  it("treats a matching schedule token as expiry authority within its floored second", async () => {
    vi.setSystemTime(new Date("2026-08-30T12:00:00.123Z"));
    const { computer, sandbox, scheduleControl } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });
    await computer.setOwnerControl(true);
    const payload = vi.mocked(scheduleControl).mock.calls[0]?.[1];
    if (!payload) throw new Error("The owner-control lease was not scheduled");

    await vi.advanceTimersByTimeAsync(89_877);
    await computer.settleOwnerControl(payload);

    expect(sandbox.exec).toHaveBeenCalledWith("x11vnc -display :99 -sync -R viewonly", {
      timeout: 5_000
    });
  });

  it("renews only an active owner lease without enabling native input again", async () => {
    const { computer, sandbox, scheduleControl } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });
    await computer.setOwnerControl(true);
    vi.mocked(sandbox.exec).mockClear();

    await expect(computer.setOwnerControl(true, true)).resolves.toMatchObject({
      ownerControl: true,
      running: true
    });

    expect(scheduleControl).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(sandbox.exec)
        .mock.calls.some(([command]) => String(command).includes("-R noviewonly"))
    ).toBe(false);
  });

  it("rolls back the durable grant when native VNC cannot become interactive", async () => {
    const { computer, sandbox, scheduleControl, storage } = harness();
    vi.mocked(sandbox.exec).mockImplementation(async (command: string) => ({
      duration: 1,
      exitCode: command.includes("-R noviewonly") ? 1 : 0,
      stderr: command.includes("-R noviewonly") ? "VNC control failed" : "",
      stdout: ""
    }));
    await computer.acquire({ eventId: "desktop:open", taskId: null });

    await expect(computer.setOwnerControl(true)).rejects.toThrow("VNC control failed");

    expect(scheduleControl).toHaveBeenCalledOnce();
    expect(storage.data.has("hqbot:computer:owner-control-until")).toBe(false);
    expect(sandbox.exec).toHaveBeenCalledWith("x11vnc -display :99 -sync -R viewonly", {
      timeout: 5_000
    });
  });

  it("stops fail closed when both native grant and rollback fail", async () => {
    const { computer, sandbox, storage } = harness();
    vi.mocked(sandbox.exec).mockImplementation(async (command: string) => ({
      duration: 1,
      exitCode: command.includes("-R") ? 1 : 0,
      stderr: command.includes("-R noviewonly") ? "VNC grant failed" : "VNC revoke failed",
      stdout: ""
    }));
    await computer.acquire({ eventId: "desktop:open", taskId: null });

    await expect(computer.setOwnerControl(true)).rejects.toThrow("VNC grant failed");

    expect(sandbox.stop).toHaveBeenCalledOnce();
    expect(storage.data.has("hqbot:computer:running")).toBe(false);
    expect(storage.data.has("hqbot:computer:owner-control-until")).toBe(false);
  });

  it("stops the computer when native owner-control revocation fails", async () => {
    const { computer, sandbox, storage } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });
    await computer.setOwnerControl(true);
    vi.mocked(sandbox.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 1,
      stderr: "VNC revoke failed",
      stdout: ""
    } as never);

    await expect(computer.setOwnerControl(false)).resolves.toMatchObject({
      ownerControl: false,
      running: false
    });

    expect(sandbox.stop).toHaveBeenCalledOnce();
    expect(storage.data.has("hqbot:computer:owner-control-until")).toBe(false);
  });

  it("keeps durable revoking state when neither view-only nor stop can be confirmed", async () => {
    const { computer, sandbox, scheduleControl, storage } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });
    await computer.setOwnerControl(true);
    vi.mocked(sandbox.exec).mockImplementation(async (command: string) => ({
      duration: 1,
      exitCode: command.includes("-R viewonly") ? 1 : 0,
      stderr: command.includes("-R viewonly") ? "VNC revoke failed" : "",
      stdout: ""
    }));
    vi.mocked(sandbox.stop).mockRejectedValue(new Error("Sandbox stop failed"));

    await expect(computer.setOwnerControl(false)).rejects.toThrow("VNC revoke failed");

    const retry = vi.mocked(scheduleControl).mock.calls[1]?.[1];
    expect(retry).toBeDefined();
    expect(storage.data.get("hqbot:computer:owner-control-until")).toMatchObject({
      state: "revoking",
      token: retry?.token
    });
    expect(storage.data.get("hqbot:computer:running")).toBe(true);
    await expect(computer.status()).resolves.toMatchObject({ ownerControl: false, running: true });
    await expect(computer.setOwnerControl(true, true)).resolves.toBeNull();
    await expect(computer.assertModelControlAvailable()).rejects.toThrow(
      "The owner is controlling this computer"
    );
  });

  it("serializes a revoke behind an in-flight owner grant", async () => {
    const { computer, sandbox, storage } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });
    let releaseGrant: () => void = () => undefined;
    let markGrantStarted: () => void = () => undefined;
    const grantStarted = new Promise<void>((resolve) => {
      markGrantStarted = resolve;
    });
    const grantGate = new Promise<void>((resolve) => {
      releaseGrant = resolve;
    });
    vi.mocked(sandbox.exec).mockImplementation(async (command: string) => {
      if (command.includes("-R noviewonly")) {
        markGrantStarted();
        await grantGate;
      }
      return { duration: 1, exitCode: 0, stderr: "", stdout: "" };
    });

    const grant = computer.setOwnerControl(true);
    await grantStarted;
    const revoke = computer.setOwnerControl(false);
    await Promise.resolve();
    expect(
      vi
        .mocked(sandbox.exec)
        .mock.calls.some(([command]) => String(command).includes("-R viewonly"))
    ).toBe(false);

    releaseGrant();
    await grant;
    await expect(revoke).resolves.toMatchObject({ ownerControl: false, running: true });
    expect(storage.data.has("hqbot:computer:owner-control-until")).toBe(false);
  });

  it("blocks an owner grant while managed Bash is active", async () => {
    let managed = false;
    const { computer, sandbox, scheduleControl } = harness(() => managed);
    await computer.acquire({ eventId: "bash:call-1", taskId: "task-1" });
    managed = true;

    await expect(computer.setOwnerControl(true)).rejects.toThrow(
      "Wait until the Bash process finishes"
    );

    expect(scheduleControl).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(sandbox.exec)
        .mock.calls.some(([command]) => String(command).includes("-R noviewonly"))
    ).toBe(false);
  });

  it("blocks model computer controls while a Bash process is managed", async () => {
    let managed = true;
    const { computer } = harness(() => managed);

    await expect(computer.assertModelControlAvailable()).rejects.toThrow(
      "A Bash process is running. Wait until it finishes."
    );

    managed = false;
    await expect(computer.assertModelControlAvailable()).resolves.toBeUndefined();
  });

  it("does not stop the shared computer while a process is managed", async () => {
    let managed = false;
    const { computer, sandbox } = harness(() => managed);
    await computer.acquire({ eventId: "bash:call-1", taskId: "task-1" });
    managed = true;

    await computer.stop();

    expect(sandbox.stop).not.toHaveBeenCalled();
  });

  it("does not start an off computer only to take owner control", async () => {
    const { computer, sandbox } = harness();

    await expect(computer.setOwnerControl(true)).rejects.toThrow(
      "Open the computer before you take control"
    );
    expect(sandbox.setKeepAlive).not.toHaveBeenCalled();
  });

  it("restores native view-only enforcement when a running teammate wakes", async () => {
    const { computer, desktopProcess, sandbox } = harness();
    await computer.acquire({ eventId: "bash:call-1", taskId: null });

    await computer.reconcileOwnerControl();

    expect(desktopProcess.waitForPort).toHaveBeenCalledOnce();
    expect(sandbox.exec).toHaveBeenCalledWith("x11vnc -display :99 -sync -R viewonly", {
      timeout: 5_000
    });
  });

  it("stops a durable revocation without reopening owner input after recovery", async () => {
    const { computer, desktopProcess, sandbox, storage } = harness();
    storage.data.set("hqbot:computer:running", true);
    storage.data.set("hqbot:computer:owner-control-until", {
      expiresAt: Date.now() + 90_000,
      scheduleId: "control-schedule",
      state: "revoking",
      token: "control-token"
    });

    await computer.reconcileOwnerControl();

    expect(sandbox.exec).toHaveBeenCalledWith("x11vnc -display :99 -sync -R viewonly", {
      timeout: 5_000
    });
    expect(
      vi
        .mocked(sandbox.exec)
        .mock.calls.some(([command]) => String(command).includes("-R noviewonly"))
    ).toBe(false);
    expect(desktopProcess.waitForPort).not.toHaveBeenCalled();
    expect(sandbox.stop).toHaveBeenCalledOnce();
    expect(storage.data.has("hqbot:computer:owner-control-until")).toBe(false);
  });

  it("revokes a legacy unscheduled owner-control value during recovery", async () => {
    const { computer, sandbox, scheduleControl, storage } = harness();
    storage.data.set("hqbot:computer:running", true);
    storage.data.set("hqbot:computer:owner-control-until", Date.now() + 90_000);

    await computer.reconcileOwnerControl();

    expect(scheduleControl).not.toHaveBeenCalled();
    expect(sandbox.exec).toHaveBeenCalledWith("x11vnc -display :99 -sync -R viewonly", {
      timeout: 5_000
    });
    expect(storage.data.has("hqbot:computer:owner-control-until")).toBe(false);
  });

  it("checkpoints and stops when the managed idle lease expires", async () => {
    const { artifacts, cancelSchedule, computer, sandbox, scheduleSleep } = harness();
    await computer.acquire({ eventId: "bash:call-1", taskId: null });
    const payload = vi.mocked(scheduleSleep).mock.calls[0]?.[1];
    if (!payload) throw new Error("The sleep lease was not scheduled");

    await vi.advanceTimersByTimeAsync(1_800_000);
    await computer.settle(payload);

    expect(artifacts.put).toHaveBeenCalledWith(
      COMPUTER_CHECKPOINT_KEY("bot-1"),
      expect.any(ReadableStream),
      { httpMetadata: { contentType: "application/gzip" } }
    );
    expect(cancelSchedule).toHaveBeenCalledWith("schedule-1");
    expect(sandbox.setKeepAlive).toHaveBeenLastCalledWith(false);
    expect(sandbox.stop).toHaveBeenCalledOnce();
    await expect(computer.status()).resolves.toMatchObject({
      checkpointAt: "2026-08-30T12:30:00.000Z",
      resources: null,
      running: false
    });
  });

  it("ignores a stale lease after later activity re-arms the computer", async () => {
    const { computer, sandbox, scheduleSleep } = harness();
    await computer.acquire({ eventId: "first", taskId: null });
    const stale = vi.mocked(scheduleSleep).mock.calls[0]?.[1];
    if (!stale) throw new Error("The first sleep lease was not scheduled");

    await vi.advanceTimersByTimeAsync(60_000);
    await computer.acquire({ eventId: "second", taskId: null });
    await vi.advanceTimersByTimeAsync(1_740_000);
    await computer.settle(stale);

    expect(sandbox.stop).not.toHaveBeenCalled();
  });

  it("serializes new activity before an old idle settlement", async () => {
    const { computer, sandbox, scheduleSleep } = harness();
    await computer.acquire({ eventId: "first", taskId: null });
    const stale = vi.mocked(scheduleSleep).mock.calls[0]?.[1];
    if (!stale) throw new Error("The first sleep lease was not scheduled");
    await vi.advanceTimersByTimeAsync(1_800_000);
    let releaseSchedule: () => void = () => undefined;
    let markScheduleStarted: () => void = () => undefined;
    const scheduleStarted = new Promise<void>((resolve) => {
      markScheduleStarted = resolve;
    });
    const scheduleGate = new Promise<void>((resolve) => {
      releaseSchedule = resolve;
    });
    vi.mocked(scheduleSleep).mockImplementationOnce(async () => {
      markScheduleStarted();
      await scheduleGate;
      return { id: "new-sleep-schedule" };
    });

    const acquire = computer.acquire({ eventId: "second", taskId: null });
    await scheduleStarted;
    const settle = computer.settle(stale);
    releaseSchedule();
    await acquire;
    await settle;

    expect(sandbox.stop).not.toHaveBeenCalled();
  });

  it("creates a successor sleep wake when an idle stop cannot be confirmed", async () => {
    const { computer, sandbox, scheduleSleep, storage } = harness();
    await computer.acquire({ eventId: "first", taskId: null });
    const payload = vi.mocked(scheduleSleep).mock.calls[0]?.[1];
    if (!payload) throw new Error("The sleep lease was not scheduled");
    vi.mocked(sandbox.stop).mockRejectedValueOnce(new Error("Sandbox stop failed"));
    await vi.advanceTimersByTimeAsync(1_800_000);

    await expect(computer.settle(payload)).rejects.toThrow("Sandbox stop failed");

    const retry = vi.mocked(scheduleSleep).mock.calls[1]?.[1];
    expect(retry).toBeDefined();
    expect(storage.data.get("hqbot:computer:lease")).toMatchObject({ token: retry?.token });
  });

  it("re-arms an expired idle lease while a Bash process is managed", async () => {
    let managed = true;
    const { computer, sandbox, scheduleSleep } = harness(() => managed);
    await computer.acquire({ eventId: "bash:call-1", taskId: "task-1" });
    const first = vi.mocked(scheduleSleep).mock.calls[0]?.[1];
    if (!first) throw new Error("The first sleep lease was not scheduled");

    await vi.advanceTimersByTimeAsync(1_800_000);
    await computer.settle(first);

    expect(sandbox.stop).not.toHaveBeenCalled();
    expect(scheduleSleep).toHaveBeenCalledTimes(2);

    managed = false;
    const second = vi.mocked(scheduleSleep).mock.calls[1]?.[1];
    if (!second) throw new Error("The managed-process lease was not re-armed");
    await vi.advanceTimersByTimeAsync(1_800_000);
    await computer.settle(second);

    expect(sandbox.stop).toHaveBeenCalledOnce();
  });

  it("stops safely when a managed lease cannot keep a durable wake", async () => {
    const { computer, sandbox, scheduleSleep, storage } = harness(() => true);
    await computer.acquire({ eventId: "bash:call-1", taskId: "task-1" });
    const payload = vi.mocked(scheduleSleep).mock.calls[0]?.[1];
    if (!payload) throw new Error("The first sleep lease was not scheduled");
    vi.mocked(scheduleSleep).mockRejectedValueOnce(new Error("Schedule is unavailable"));

    await vi.advanceTimersByTimeAsync(1_800_000);
    await expect(computer.settle(payload)).resolves.toBeUndefined();

    expect(sandbox.stop).toHaveBeenCalledOnce();
    expect(storage.data.has("hqbot:computer:lease")).toBe(false);
  });

  it("stops the computer when an early one-shot lease cannot be replaced", async () => {
    const { computer, sandbox, scheduleSleep } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });
    const payload = vi.mocked(scheduleSleep).mock.calls[0]?.[1];
    if (!payload) throw new Error("The first sleep lease was not scheduled");
    vi.mocked(scheduleSleep).mockRejectedValueOnce(new Error("Schedule is unavailable"));

    await expect(computer.settle(payload)).resolves.toBeUndefined();

    expect(sandbox.stop).toHaveBeenCalledOnce();
  });

  it("stops an idle computer even when its best-effort checkpoint fails", async () => {
    const { artifacts, computer, sandbox } = harness();
    await computer.acquire({ eventId: "bash:call-1", taskId: null });
    vi.mocked(artifacts.put).mockRejectedValueOnce(new Error("R2 is unavailable"));

    await expect(computer.stop()).resolves.toBeUndefined();

    expect(sandbox.setKeepAlive).toHaveBeenLastCalledWith(false);
    expect(sandbox.stop).toHaveBeenCalledOnce();
    await expect(computer.status()).resolves.toMatchObject({ running: false });
  });

  it("revokes native input before a potentially long stop checkpoint", async () => {
    const { computer, sandbox } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });
    await computer.setOwnerControl(true);
    vi.mocked(sandbox.exec).mockClear();

    await computer.stop();

    expect(sandbox.exec).toHaveBeenNthCalledWith(1, "x11vnc -display :99 -sync -R viewonly", {
      timeout: 5_000
    });
    expect(sandbox.exec).toHaveBeenNthCalledWith(
      2,
      "pkill -TERM -f '[g]oogle-chrome' || true; sleep 1",
      { timeout: 5_000 }
    );
  });

  it("keeps revoking state and a retry when stop cannot be confirmed", async () => {
    const { computer, sandbox, scheduleControl, storage } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });
    await computer.setOwnerControl(true);
    vi.mocked(sandbox.stop).mockRejectedValueOnce(new Error("Sandbox stop failed"));

    await expect(computer.stop(false, true)).rejects.toThrow("Sandbox stop failed");

    const retry = vi.mocked(scheduleControl).mock.calls[1]?.[1];
    expect(storage.data.get("hqbot:computer:owner-control-until")).toMatchObject({
      state: "revoking",
      token: retry?.token
    });
    expect(storage.data.get("hqbot:computer:running")).toBe(true);
  });

  it("creates periodic recovery checkpoints without extending the idle lease", async () => {
    const { artifacts, computer, recordResourceUsage, sandbox, scheduleSleep } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });

    expect(scheduleSleep).toHaveBeenCalledOnce();
    expect(recordResourceUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        service: "sandbox",
        units: 1_800,
        estimatedCostMicroUsd: 37_008
      })
    );

    await vi.advanceTimersByTimeAsync(3_600_000);
    await computer.recoveryCheckpoint();

    expect(recordResourceUsage).toHaveBeenCalledOnce();
    expect(sandbox.exec).not.toHaveBeenCalledWith(
      "pkill -TERM -f '[g]oogle-chrome' || true; sleep 1",
      expect.anything()
    );
    expect(artifacts.put).toHaveBeenCalledOnce();
  });

  it("stops a managed process when its next computer reservation is over budget", async () => {
    const { checkSpendPolicy, computer, recordResourceUsage, sandbox, scheduleSleep } = harness(
      () => true
    );
    await computer.acquire({ eventId: "bash:call-1", taskId: "task-1" });
    const payload = vi.mocked(scheduleSleep).mock.calls[0]?.[1];
    if (!payload) throw new Error("The first sleep lease was not scheduled");
    vi.mocked(checkSpendPolicy).mockResolvedValueOnce({
      allowed: false,
      reason: "The teammate daily cost budget has been reached"
    });

    await vi.advanceTimersByTimeAsync(1_800_000);
    await computer.settle(payload);

    expect(recordResourceUsage).toHaveBeenCalledOnce();
    expect(sandbox.stop).toHaveBeenCalledOnce();
    await expect(computer.status()).resolves.toMatchObject({ running: false });
  });

  it("reports running state without calling the Sandbox", async () => {
    const { computer, sandbox } = harness();
    await computer.acquire({ eventId: "desktop:open", taskId: null });
    vi.mocked(sandbox.exec).mockClear();
    vi.mocked(sandbox.exists).mockClear();
    vi.mocked(sandbox.setKeepAlive).mockClear();

    await expect(computer.status()).resolves.toMatchObject({
      ownerControl: false,
      resources: null,
      running: true
    });
    expect(sandbox.exec).not.toHaveBeenCalled();
    expect(sandbox.exists).not.toHaveBeenCalled();
    expect(sandbox.setKeepAlive).not.toHaveBeenCalled();
  });
});
