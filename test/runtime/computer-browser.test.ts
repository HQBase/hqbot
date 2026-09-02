import type { Process } from "@cloudflare/sandbox";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { TeammateComputer } from "../../src/runtime/computer";
import { createComputerBrowserTools } from "../../src/runtime/computer-browser";

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
      stdout: JSON.stringify({ title: "Example", url: "https://example.com/" })
    }),
    getProcess: vi.fn().mockResolvedValue(process),
    readFile: vi.fn().mockResolvedValue({
      content: "anBlZyBieXRlcw==",
      encoding: "base64",
      mimeType: "image/jpeg",
      size: 10
    }),
    startProcess: vi.fn(),
    wsConnect: vi.fn()
  };
  const assertModelControlAvailable = vi.fn().mockResolvedValue(undefined);
  const acquire = vi.fn().mockResolvedValue(sandbox);
  const computer = {
    acquire,
    assertModelControlAvailable
  } as unknown as TeammateComputer;
  const tools = createComputerBrowserTools({
    botId: "bot-1",
    computer,
    taskId: () => "task-1"
  });
  return {
    acquire,
    assertModelControlAvailable,
    process,
    sandbox,
    tools
  };
}

describe("visible Chrome tools", () => {
  it("offers structured tools without Browser Run execute or scrape tools", () => {
    const { tools } = harness();

    expect(Object.keys(tools).sort()).toEqual([
      "browser_click",
      "browser_evaluate",
      "browser_open",
      "browser_press",
      "browser_screenshot",
      "browser_snapshot",
      "browser_tabs",
      "browser_type"
    ]);
    expect(tools).not.toHaveProperty("browser_execute");
    expect(tools).not.toHaveProperty("browser_markdown");
  });

  it("evaluates bounded JavaScript in the selected visible tab", async () => {
    const { sandbox, tools } = harness();
    vi.mocked(sandbox.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ result: "Example Domain", url: "https://example.com/" })
    });

    await expect(
      execute(tools.browser_evaluate, { script: "document.querySelector('h1')?.textContent" })
    ).resolves.toEqual({ result: "Example Domain", url: "https://example.com/" });
    expect(sandbox.exec).toHaveBeenCalledWith("/usr/local/bin/hqbot-browser-control", {
      env: {
        HQBOT_BROWSER_INPUT: JSON.stringify({
          action: "evaluate",
          script: "document.querySelector('h1')?.textContent"
        })
      },
      timeout: 30_000
    });
  });

  it("presses one key on a referenced browser control", async () => {
    const { sandbox, tools } = harness();

    await expect(
      execute(tools.browser_press, { key: "Enter", ref: "e14" }, "press-1")
    ).resolves.toEqual({ title: "Example", url: "https://example.com/" });
    expect(sandbox.exec).toHaveBeenCalledWith("/usr/local/bin/hqbot-browser-control", {
      env: {
        HQBOT_BROWSER_INPUT: JSON.stringify({ action: "press", key: "Enter", ref: "e14" })
      },
      timeout: 30_000
    });
  });

  it("controls Chrome in the acquired teammate computer and starts the same visible desktop", async () => {
    const { acquire, assertModelControlAvailable, process, sandbox, tools } = harness();

    await expect(
      execute(tools.browser_open, { url: "https://example.com/" }, "open-1")
    ).resolves.toEqual({ title: "Example", url: "https://example.com/" });

    expect(assertModelControlAvailable).toHaveBeenCalledTimes(3);
    expect(acquire).toHaveBeenCalledWith({ eventId: "browser:open-1", taskId: "task-1" });
    expect(process.waitForPort).toHaveBeenCalledWith(6080, { mode: "tcp", timeout: 60_000 });
    expect(sandbox.exec).toHaveBeenCalledWith("/usr/local/bin/hqbot-browser-control", {
      env: {
        HQBOT_BROWSER_INPUT: JSON.stringify({ action: "open", url: "https://example.com/" })
      },
      timeout: 30_000
    });
  });

  it("does not acquire or operate Chrome while the owner has control", async () => {
    const { acquire, assertModelControlAvailable, sandbox, tools } = harness();
    vi.mocked(assertModelControlAvailable).mockRejectedValueOnce(
      new Error("The owner is controlling this computer. Wait until they return control.")
    );

    await expect(execute(tools.browser_snapshot, {})).rejects.toThrow(
      "The owner is controlling this computer"
    );
    expect(acquire).not.toHaveBeenCalled();
    expect(sandbox.exec).not.toHaveBeenCalled();
  });

  it("does not start Chrome control when owner control begins during desktop startup", async () => {
    const { assertModelControlAvailable, process, sandbox, tools } = harness();
    vi.mocked(assertModelControlAvailable)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("The owner is controlling this computer"));

    await expect(
      execute(tools.browser_open, { url: "https://example.com/" }, "open-1")
    ).rejects.toThrow("The owner is controlling this computer");

    expect(process.waitForPort).toHaveBeenCalledOnce();
    expect(sandbox.exec).not.toHaveBeenCalled();
  });

  it("returns a Chrome command error without hiding its message", async () => {
    const { sandbox, tools } = harness();
    vi.mocked(sandbox.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 1,
      stderr: "Element reference is stale. Take a new snapshot.",
      stdout: ""
    });

    await expect(execute(tools.browser_click, { ref: "e1" })).rejects.toThrow(
      "Element reference is stale. Take a new snapshot."
    );
  });

  it("returns a bounded screenshot to the model and removes the temporary image", async () => {
    const { sandbox, tools } = harness();
    vi.mocked(sandbox.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ url: "https://example.com/" })
    });

    const output = await execute(tools.browser_screenshot, {});

    expect(output).toEqual({
      data: "anBlZyBieXRlcw==",
      mediaType: "image/jpeg",
      type: "browser_screenshot",
      url: "https://example.com/"
    });
    expect(sandbox.readFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/hqbot-browser-[\w-]+\.jpg$/u),
      { encoding: "base64" }
    );
    expect(sandbox.deleteFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/hqbot-browser-[\w-]+\.jpg$/u)
    );

    if (!tools.browser_screenshot.toModelOutput) throw new Error("Missing model output mapper");
    expect(
      await tools.browser_screenshot.toModelOutput({ input: {}, output, toolCallId: "shot-1" })
    ).toEqual({
      type: "content",
      value: [
        { type: "text", text: "Browser screenshot of https://example.com/." },
        {
          type: "file",
          filename: "browser-screenshot.jpg",
          mediaType: "image/jpeg",
          data: { type: "data", data: "anBlZyBieXRlcw==" }
        }
      ]
    });
  });

  it("does not decode a screenshot that Think shortened in older context", async () => {
    const { tools } = harness();
    if (!tools.browser_screenshot.toModelOutput) throw new Error("Missing model output mapper");

    expect(
      tools.browser_screenshot.toModelOutput({
        input: {},
        output: {
          data: "/9j/4AAQ... [truncated 69732 chars]",
          mediaType: "image/jpeg",
          type: "browser_screenshot",
          url: "https://example.com/"
        },
        toolCallId: "old-shot"
      })
    ).toEqual({
      type: "text",
      value:
        "Browser screenshot of https://example.com/. The image is no longer in recent model context. Capture a new screenshot to inspect it again."
    });
  });

  it("rejects an oversized screenshot and still removes its temporary image", async () => {
    const { sandbox, tools } = harness();
    vi.mocked(sandbox.exec).mockResolvedValueOnce({
      duration: 1,
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ url: "https://example.com/" })
    });
    vi.mocked(sandbox.readFile).mockResolvedValueOnce({
      content: "eA==",
      encoding: "base64",
      mimeType: "image/jpeg",
      size: 5_000_001
    });

    await expect(execute(tools.browser_screenshot, {})).rejects.toThrow(
      "The browser screenshot is too large"
    );
    expect(sandbox.deleteFile).toHaveBeenCalledOnce();
  });
});
