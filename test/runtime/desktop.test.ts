import { readFile } from "node:fs/promises";
import { getSandbox, type Process } from "@cloudflare/sandbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMPUTER_CHECKPOINT_KEY,
  COMPUTER_IDLE_SECONDS,
  checkpointComputer,
  connectLinuxDesktop,
  DESKTOP_PORT,
  estimateComputerMicroUsd,
  type LinuxDesktopSandbox,
  openLinuxDesktop,
  parseComputerResourceSample,
  readComputerResources,
  restoreComputer,
  setLinuxDesktopOwnerControl,
  stopLinuxComputer,
  teammateSandbox
} from "../../src/runtime/desktop";

vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));
const getSandboxMock = vi.mocked(getSandbox);

function process(status: Process["status"] = "running"): Process {
  return {
    getStatus: vi.fn().mockResolvedValue(status),
    waitForPort: vi.fn().mockResolvedValue(undefined)
  } as unknown as Process;
}

function sandbox(current: Process | null = null) {
  const started = process("starting");
  const stub = {
    cleanupCompletedProcesses: vi.fn().mockResolvedValue(0),
    deleteFile: vi.fn().mockResolvedValue({ success: true }),
    destroy: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue({ duration: 1, exitCode: 0, stderr: "", stdout: "" }),
    exists: vi.fn().mockResolvedValue({ exists: false }),
    getProcess: vi.fn().mockResolvedValue(current),
    readFile: vi.fn().mockResolvedValue({
      content: new Blob(["checkpoint"]).stream(),
      mimeType: "application/gzip",
      size: 10
    }),
    setKeepAlive: vi.fn().mockResolvedValue(undefined),
    startProcess: vi.fn().mockResolvedValue(started),
    stop: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue({ success: true }),
    wsConnect: vi.fn().mockResolvedValue(new Response())
  } as unknown as LinuxDesktopSandbox;
  return { current, started, stub };
}

function bucket(checkpoint: { body: ReadableStream; size: number } | null = null) {
  return {
    delete: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(checkpoint),
    put: vi.fn().mockResolvedValue(undefined)
  };
}

describe("teammate Linux computer", () => {
  beforeEach(() => {
    getSandboxMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses one stable always-live Sandbox handle for CLI, browser, and desktop work", () => {
    const binding = {} as Env["SANDBOX"];
    const shared = sandbox().stub;
    getSandboxMock.mockReturnValue(shared as never);

    expect(teammateSandbox({ SANDBOX: binding } as Env, "Bot One")).toBe(shared);
    expect(getSandboxMock).toHaveBeenCalledWith(binding, "desktop-Bot One", {
      enableDefaultSession: true,
      keepAlive: true,
      labels: { product: "hqbot", teammate: "Bot One" },
      normalizeId: true,
      sleepAfter: "30m",
      transport: "rpc"
    });
  });

  it("defines one managed idle window and its cost estimate", () => {
    expect(COMPUTER_IDLE_SECONDS).toBe(1_800);
    expect(estimateComputerMicroUsd(1_800)).toBe(37_008);
    expect(estimateComputerMicroUsd(86_400)).toBe(1_776_384);
  });

  it("starts one desktop process and waits for its private VNC bridge", async () => {
    const runtime = sandbox();

    await expect(openLinuxDesktop(runtime.stub, "bot one")).resolves.toEqual({
      webSocketPath: "/api/bots/bot%20one/desktop/ws"
    });
    expect(runtime.stub.cleanupCompletedProcesses).toHaveBeenCalledOnce();
    expect(runtime.stub.startProcess).toHaveBeenCalledWith("/usr/local/bin/hqbot-desktop", {
      autoCleanup: false,
      processId: "hqbot-desktop"
    });
    expect(runtime.started.waitForPort).toHaveBeenCalledWith(DESKTOP_PORT, {
      mode: "tcp",
      timeout: 60_000
    });
  });

  it("reuses a running desktop and connects the owner WebSocket", async () => {
    const current = process();
    const runtime = sandbox(current);
    const request = new Request("https://hqbot.example/api/bots/bot-1/desktop/ws", {
      headers: { Upgrade: "websocket" }
    });

    await connectLinuxDesktop(runtime.stub, "bot-1", request);

    expect(runtime.stub.startProcess).not.toHaveBeenCalled();
    expect(current.waitForPort).toHaveBeenCalledOnce();
    expect(runtime.stub.wsConnect).toHaveBeenCalledWith(request, DESKTOP_PORT);
  });

  it("starts the VNC server in native view-only mode", async () => {
    const script = await readFile(
      new URL("../../scripts/start-desktop.sh", import.meta.url),
      "utf8"
    );

    expect(script).toMatch(/x11vnc[\s\S]*-viewonly/u);
  });

  it("changes native VNC input only for an agent-granted control lease", async () => {
    const runtime = sandbox();

    await setLinuxDesktopOwnerControl(runtime.stub, true);
    await setLinuxDesktopOwnerControl(runtime.stub, false);

    expect(runtime.stub.exec).toHaveBeenNthCalledWith(
      1,
      "x11vnc -display :99 -sync -R noviewonly",
      {
        timeout: 5_000
      }
    );
    expect(runtime.stub.exec).toHaveBeenNthCalledWith(2, "x11vnc -display :99 -sync -R viewonly", {
      timeout: 5_000
    });
  });

  it("fails closed when native VNC control cannot change", async () => {
    const runtime = sandbox();
    vi.mocked(runtime.stub.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 1,
      stderr: "remote control failed",
      stdout: ""
    } as never);

    await expect(setLinuxDesktopOwnerControl(runtime.stub, true)).rejects.toThrow(
      "remote control failed"
    );
  });

  it("prepares a new workspace when no R2 checkpoint exists", async () => {
    const runtime = sandbox();
    const storage = bucket();

    await expect(restoreComputer(runtime.stub, storage, "bot-1")).resolves.toEqual({
      restored: false,
      size: 0
    });
    expect(storage.get).toHaveBeenCalledWith(COMPUTER_CHECKPOINT_KEY("bot-1"));
    expect(runtime.stub.writeFile).not.toHaveBeenCalled();
    expect(runtime.stub.exec).toHaveBeenCalledWith(
      "mkdir -p /workspace/hqbot && touch /tmp/hqbot-computer-prepared"
    );
  });

  it("streams the latest R2 checkpoint into the Sandbox before tools start", async () => {
    const runtime = sandbox();
    const body = new Blob(["saved workspace"]).stream();
    const storage = bucket({ body, size: 15 });

    await expect(restoreComputer(runtime.stub, storage, "bot-1")).resolves.toEqual({
      restored: true,
      size: 15
    });
    expect(runtime.stub.writeFile).toHaveBeenCalledWith("/tmp/hqbot-workspace.tar.gz", body);
    expect(runtime.stub.exec).toHaveBeenCalledWith(
      "mkdir -p /workspace && tar -xzf /tmp/hqbot-workspace.tar.gz -C /workspace && touch /tmp/hqbot-computer-prepared",
      { timeout: 120_000 }
    );
    expect(runtime.stub.deleteFile).toHaveBeenCalledWith("/tmp/hqbot-workspace.tar.gz");
  });

  it("removes a corrupt R2 checkpoint and starts with a clean workspace", async () => {
    const runtime = sandbox();
    vi.mocked(runtime.stub.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 1,
      stderr: "invalid archive",
      stdout: ""
    } as never);
    const storage = bucket({ body: new Blob(["broken"]).stream(), size: 6 });

    await expect(restoreComputer(runtime.stub, storage, "bot-1")).resolves.toEqual({
      restored: false,
      size: 0
    });
    expect(storage.delete).toHaveBeenCalledWith(COMPUTER_CHECKPOINT_KEY("bot-1"));
    expect(runtime.stub.exec).toHaveBeenNthCalledWith(
      2,
      "find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && mkdir -p /workspace/hqbot && touch /tmp/hqbot-computer-prepared",
      { timeout: 120_000 }
    );
    expect(runtime.stub.deleteFile).toHaveBeenCalledWith("/tmp/hqbot-workspace.tar.gz");
  });

  it("closes Chrome for a clean stop and streams the workspace checkpoint to R2", async () => {
    const runtime = sandbox();
    const storage = bucket();

    await expect(checkpointComputer(runtime.stub, storage, "bot-1", true)).resolves.toEqual({
      size: 10
    });
    expect(runtime.stub.exec).toHaveBeenNthCalledWith(
      1,
      "pkill -TERM -f '[g]oogle-chrome' || true; sleep 1",
      { timeout: 5_000 }
    );
    expect(runtime.stub.exec).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("tar --ignore-failed-read"),
      { timeout: 120_000 }
    );
    expect(storage.put).toHaveBeenCalledWith(
      COMPUTER_CHECKPOINT_KEY("bot-1"),
      expect.any(ReadableStream),
      { httpMetadata: { contentType: "application/gzip" } }
    );
    expect(runtime.stub.deleteFile).toHaveBeenCalledWith("/tmp/hqbot-workspace.tar.gz");
  });

  it("removes a partial local checkpoint when archive creation fails", async () => {
    const runtime = sandbox();
    vi.mocked(runtime.stub.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 1,
      stderr: "disk full",
      stdout: ""
    } as never);

    await expect(checkpointComputer(runtime.stub, bucket(), "bot-1", false)).rejects.toThrow(
      "The computer checkpoint could not be created"
    );
    expect(runtime.stub.readFile).not.toHaveBeenCalled();
    expect(runtime.stub.deleteFile).toHaveBeenCalledWith("/tmp/hqbot-workspace.tar.gz");
  });

  it("validates and reports CPU, memory, disk, uptime, and estimated cost", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:10.000Z"));
    const runtime = sandbox();
    vi.mocked(runtime.stub.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        cpuPercent: 12.5,
        memoryBytes: 512,
        memoryLimitBytes: 1_024,
        diskBytes: 2_048,
        diskLimitBytes: null
      })
    } as never);

    await expect(
      readComputerResources(runtime.stub, Date.parse("2026-08-30T12:00:00.000Z"))
    ).resolves.toEqual({
      cpuPercent: 12.5,
      memoryBytes: 512,
      memoryLimitBytes: 1_024,
      diskBytes: 2_048,
      diskLimitBytes: null,
      uptimeSeconds: 10,
      estimatedCostUsd: 0.000206,
      updatedAt: "2026-08-30T12:00:10.000Z"
    });
    expect(runtime.stub.exec).toHaveBeenCalledWith("/usr/local/bin/hqbot-computer-resources", {
      timeout: 5_000
    });
  });

  it.each([
    "null",
    "{}",
    '{"cpuPercent":-1,"memoryBytes":0,"memoryLimitBytes":null,"diskBytes":0,"diskLimitBytes":null}',
    '{"cpuPercent":0,"memoryBytes":"0","memoryLimitBytes":null,"diskBytes":0,"diskLimitBytes":null}'
  ])("rejects an invalid computer resource sample: %s", (sample) => {
    expect(() => parseComputerResourceSample(sample)).toThrow("Invalid computer resource sample");
  });

  it("disables keep-alive before it stops the computer", async () => {
    const runtime = sandbox();

    await stopLinuxComputer(runtime.stub);

    expect(runtime.stub.setKeepAlive).toHaveBeenCalledWith(false);
    expect(runtime.stub.stop).toHaveBeenCalledOnce();
    expect(vi.mocked(runtime.stub.setKeepAlive).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runtime.stub.stop).mock.invocationCallOrder[0] ?? 0
    );
  });

  it("still confirms stop when disabling keep-alive fails", async () => {
    const runtime = sandbox();
    vi.mocked(runtime.stub.setKeepAlive).mockRejectedValueOnce(new Error("Keep-alive failed"));

    await expect(stopLinuxComputer(runtime.stub)).resolves.toBeUndefined();

    expect(runtime.stub.stop).toHaveBeenCalledOnce();
  });
});
