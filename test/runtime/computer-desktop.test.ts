import type { Process } from "@cloudflare/sandbox";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import type { TeammateComputer } from "../../src/runtime/computer";
import { createComputerDesktopTools } from "../../src/runtime/computer-desktop";

vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));

async function execute(tool: ToolSet[string], input: unknown, toolCallId = "call-1") {
  if (!tool.execute) throw new Error("Tool is not executable");
  return tool.execute(input, {
    abortSignal: undefined,
    context: undefined,
    messages: [],
    toolCallId
  });
}

function parseInput(tool: ToolSet[string], input: unknown): unknown {
  return (tool.inputSchema as z.ZodType).parse(input);
}

function harness() {
  const process = {
    getStatus: vi.fn().mockResolvedValue("running"),
    waitForPort: vi.fn().mockResolvedValue(undefined)
  } as unknown as Process;
  const sandbox = {
    cleanupCompletedProcesses: vi.fn().mockResolvedValue(0),
    deleteFile: vi.fn().mockResolvedValue({ success: true }),
    exec: vi.fn().mockResolvedValue({
      duration: 1,
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ action: "click", ok: true })
    }),
    getProcess: vi.fn().mockResolvedValue(process),
    readFile: vi.fn().mockResolvedValue({
      content: "anBlZw==",
      encoding: "base64",
      mimeType: "image/jpeg",
      size: 4
    }),
    startProcess: vi.fn(),
    wsConnect: vi.fn()
  };
  const assertModelControlAvailable = vi.fn().mockResolvedValue(undefined);
  const acquire = vi.fn().mockResolvedValue(sandbox);
  const open = vi.fn().mockResolvedValue({
    webSocketPath: "/api/bots/bot-1/desktop/ws"
  });
  const setOwnerControl = vi.fn().mockImplementation(async (ownerControl: boolean) => ({
    checkpointAt: null,
    ownerControl,
    resources: null,
    running: true
  }));
  const status = vi.fn().mockResolvedValue({
    checkpointAt: null,
    ownerControl: false,
    resources: null,
    running: true
  });
  const stop = vi.fn().mockResolvedValue(undefined);
  const computer = {
    acquire,
    assertModelControlAvailable,
    open,
    setOwnerControl,
    status,
    stop
  } as unknown as TeammateComputer;
  const tools = createComputerDesktopTools({
    botId: "bot-1",
    computer,
    taskId: () => "task-1"
  });
  return {
    acquire,
    assertModelControlAvailable,
    open,
    process,
    sandbox,
    setOwnerControl,
    status,
    stop,
    tools
  };
}

describe("Linux desktop tools", () => {
  it("offers screenshot, mouse, and keyboard control", () => {
    const { tools } = harness();

    expect(Object.keys(tools).sort()).toEqual([
      "computer_session",
      "desktop_keyboard",
      "desktop_mouse",
      "desktop_screenshot"
    ]);
  });

  it("lets only the agent start and hand off the computer", async () => {
    const { open, setOwnerControl, tools } = harness();

    await expect(execute(tools.computer_session, { action: "start" }, "start-1")).resolves.toEqual({
      action: "start",
      status: {
        checkpointAt: null,
        ownerControl: false,
        resources: null,
        running: true
      }
    });
    expect(open).toHaveBeenCalledWith({ eventId: "session:start-1", taskId: "task-1" });
    expect(setOwnerControl).not.toHaveBeenCalled();

    await execute(tools.computer_session, { action: "give_to_owner" }, "give-1");
    expect(open).toHaveBeenLastCalledWith({ eventId: "session:give-1", taskId: "task-1" });
    expect(setOwnerControl).toHaveBeenCalledWith(true);

    await execute(tools.computer_session, { action: "take_back" }, "back-1");
    expect(setOwnerControl).toHaveBeenLastCalledWith(false);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("reopens a stopped container once before it gives owner control", async () => {
    const { open, setOwnerControl, tools } = harness();
    setOwnerControl
      .mockRejectedValueOnce(new Error("The container is not running, consider calling start()"))
      .mockResolvedValueOnce({
        checkpointAt: null,
        ownerControl: true,
        resources: null,
        running: true
      });

    await execute(tools.computer_session, { action: "give_to_owner" }, "give-retry");

    expect(open).toHaveBeenNthCalledWith(1, {
      eventId: "session:give-retry",
      taskId: "task-1"
    });
    expect(open).toHaveBeenNthCalledWith(2, {
      eventId: "session:give-retry:retry",
      taskId: "task-1"
    });
    expect(setOwnerControl).toHaveBeenCalledTimes(2);
  });

  it("stops the computer only through the agent session tool", async () => {
    const { open, stop, tools } = harness();

    await execute(tools.computer_session, { action: "stop" }, "stop-1");

    expect(stop).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it("controls the acquired computer after it starts the same visible desktop", async () => {
    const { acquire, assertModelControlAvailable, process, sandbox, tools } = harness();
    const input = parseInput(tools.desktop_mouse, {
      action: "click",
      button: "left",
      count: "2",
      x: "120",
      y: "240"
    });

    await expect(execute(tools.desktop_mouse, input, "mouse-1")).resolves.toEqual({
      action: "click",
      ok: true
    });

    expect(assertModelControlAvailable).toHaveBeenCalledTimes(3);
    expect(acquire).toHaveBeenCalledWith({ eventId: "desktop:mouse-1", taskId: "task-1" });
    expect(process.waitForPort).toHaveBeenCalledWith(6080, { mode: "tcp", timeout: 60_000 });
    expect(sandbox.exec).toHaveBeenCalledWith("/usr/local/bin/hqbot-desktop-control", {
      env: {
        DISPLAY: ":99",
        HQBOT_DESKTOP_INPUT: JSON.stringify({
          action: "click",
          button: "left",
          count: 2,
          x: 120,
          y: 240
        })
      },
      timeout: 20_000
    });
  });

  it("normalizes numeric strings for every mouse field and keeps validation", () => {
    const { tools } = harness();

    expect(parseInput(tools.desktop_mouse, { action: "move", x: "120", y: "240" })).toEqual({
      action: "move",
      x: 120,
      y: 240
    });
    expect(
      parseInput(tools.desktop_mouse, {
        action: "drag",
        fromX: "1e2",
        fromY: "120.0",
        toX: "300",
        toY: "400"
      })
    ).toEqual({
      action: "drag",
      button: "left",
      fromX: 100,
      fromY: 120,
      toX: 300,
      toY: 400
    });
    expect(
      parseInput(tools.desktop_mouse, {
        action: "scroll",
        deltaX: "-2",
        deltaY: "3",
        x: "500",
        y: "600"
      })
    ).toEqual({ action: "scroll", deltaX: -2, deltaY: 3, x: 500, y: 600 });

    expect(() => parseInput(tools.desktop_mouse, { action: "move", x: "", y: "2" })).toThrow();
    expect(() =>
      parseInput(tools.desktop_mouse, { action: "click", count: "4", x: "1", y: "2" })
    ).toThrow();
    expect(() =>
      parseInput(tools.desktop_mouse, {
        action: "scroll",
        deltaX: "21",
        deltaY: "0",
        x: "1",
        y: "2"
      })
    ).toThrow();
  });

  it("does not acquire or control the desktop while the owner has control", async () => {
    const { acquire, assertModelControlAvailable, sandbox, tools } = harness();
    vi.mocked(assertModelControlAvailable).mockRejectedValueOnce(
      new Error("The owner is controlling this computer. Wait until they return control.")
    );

    await expect(
      execute(tools.desktop_keyboard, { action: "type", text: "hello" })
    ).rejects.toThrow("The owner is controlling this computer");
    expect(acquire).not.toHaveBeenCalled();
    expect(sandbox.exec).not.toHaveBeenCalled();
  });

  it("returns a bounded whole-desktop image to the model and removes the temporary file", async () => {
    const { sandbox, tools } = harness();
    vi.mocked(sandbox.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ height: 900, width: 1440 })
    });

    const output = await execute(tools.desktop_screenshot, {});

    expect(output).toEqual({
      data: "anBlZw==",
      height: 900,
      mediaType: "image/jpeg",
      type: "desktop_screenshot",
      width: 1440
    });
    expect(sandbox.readFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/hqbot-desktop-[\w-]+\.jpg$/u),
      { encoding: "base64" }
    );
    expect(sandbox.deleteFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/hqbot-desktop-[\w-]+\.jpg$/u)
    );

    if (!tools.desktop_screenshot.toModelOutput) throw new Error("Missing model output mapper");
    expect(
      await tools.desktop_screenshot.toModelOutput({ input: {}, output, toolCallId: "shot-1" })
    ).toMatchObject({
      type: "content",
      value: [
        { type: "text", text: "Desktop screenshot: 1440 by 900 pixels." },
        {
          type: "file",
          filename: "desktop-screenshot.jpg",
          mediaType: "image/jpeg",
          data: { type: "data", data: "anBlZw==" }
        }
      ]
    });
  });

  it("does not decode a desktop screenshot that Think shortened in older context", async () => {
    const { tools } = harness();
    if (!tools.desktop_screenshot.toModelOutput) throw new Error("Missing model output mapper");

    expect(
      tools.desktop_screenshot.toModelOutput({
        input: {},
        output: {
          data: "/9j/4AAQ... [truncated 21240 chars]",
          height: 900,
          mediaType: "image/jpeg",
          type: "desktop_screenshot",
          width: 1440
        },
        toolCallId: "old-shot"
      })
    ).toEqual({
      type: "text",
      value:
        "Desktop screenshot: 1440 by 900 pixels. The image is no longer in recent model context. Capture a new screenshot to inspect it again."
    });
  });

  it("returns a safe command error", async () => {
    const { sandbox, tools } = harness();
    vi.mocked(sandbox.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 1,
      stderr: "The desktop action could not be completed",
      stdout: ""
    });

    await expect(
      execute(tools.desktop_keyboard, { action: "press", keys: ["ctrl+l", "Return"] })
    ).rejects.toThrow("The desktop action could not be completed");
  });

  it("rejects malformed keyboard input with a valid usage example", () => {
    const { tools } = harness();

    expect(() =>
      parseInput(tools.desktop_keyboard, { action: "press", keys: '["Return"]' })
    ).toThrow(/keys must be an array.*Valid example/u);
  });

  it("rejects an oversized screenshot and still removes its temporary file", async () => {
    const { sandbox, tools } = harness();
    vi.mocked(sandbox.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ height: 900, width: 1440 })
    });
    vi.mocked(sandbox.readFile).mockResolvedValueOnce({
      content: "eA==",
      encoding: "base64",
      mimeType: "image/jpeg",
      size: 5_000_001
    });

    await expect(execute(tools.desktop_screenshot, {})).rejects.toThrow(
      "The desktop screenshot is too large"
    );
    expect(sandbox.deleteFile).toHaveBeenCalledOnce();
  });
});
