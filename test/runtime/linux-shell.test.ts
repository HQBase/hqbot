import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import type { BotFile } from "../../src/domain/types";
import {
  createLinuxBashTool,
  LinuxProcessStartRejected,
  publishLinuxOutputs
} from "../../src/runtime/linux-shell";
import type { ArtifactBucket, ArtifactCatalog } from "../../src/services/artifacts";

const createdAt = "2026-08-30T12:00:00.000Z";
type LinuxBashOptions = Parameters<typeof createLinuxBashTool>[0];
type LinuxSandbox = ReturnType<LinuxBashOptions["sandbox"]>;

function botFile(input: Parameters<ArtifactCatalog["createFile"]>[0]): BotFile {
  return { ...input, createdAt, taskId: null };
}

function createCatalog(files: BotFile[] = []) {
  const current = [...files];
  const createFile = vi.fn<ArtifactCatalog["createFile"]>(async (input) => {
    const file = botFile(input);
    current.unshift(file);
    return file;
  });
  const deleteFile = vi.fn<ArtifactCatalog["deleteFile"]>(async (id, botId) => {
    const index = current.findIndex((file) => file.id === id && file.botId === botId);
    return index < 0 ? null : (current.splice(index, 1)[0] ?? null);
  });
  const getFile = vi.fn<ArtifactCatalog["getFile"]>(
    async (id, botId) => current.find((file) => file.id === id && file.botId === botId) ?? null
  );
  const listFiles = vi.fn<ArtifactCatalog["listFiles"]>(async (botId) =>
    current.filter((file) => file.botId === botId)
  );
  return {
    catalog: { createFile, deleteFile, getFile, listFiles } satisfies ArtifactCatalog,
    createFile,
    deleteFile,
    getFile
  };
}

async function bodyBytes(value: unknown): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    );
  }
  if (value instanceof Blob || value instanceof ReadableStream) {
    return new Uint8Array(await new Response(value).arrayBuffer());
  }
  throw new Error("Unsupported test body");
}

function createBucket(entries: Array<[string, Uint8Array]> = []) {
  const objects = new Map<string, Uint8Array<ArrayBufferLike>>(
    entries.map(([key, value]) => [key, new Uint8Array(value)])
  );
  const put = vi.fn<ArtifactBucket["put"]>(async (key, value) => {
    objects.set(key, await bodyBytes(value));
  });
  const get = vi.fn<ArtifactBucket["get"]>(async (key) => {
    const value = objects.get(key);
    return value
      ? {
          bytes: async () => new Uint8Array(value),
          text: async () => new TextDecoder().decode(value)
        }
      : null;
  });
  const remove = vi.fn<ArtifactBucket["delete"]>(async (key) => {
    objects.delete(key);
  });
  return {
    bucket: { delete: remove, get, put } satisfies ArtifactBucket,
    objects,
    put,
    remove
  };
}

interface SandboxFile {
  bytes: Uint8Array;
  mimeType: string;
  reportedSize?: number;
  type?: "file" | "directory" | "symlink";
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const copy = new Uint8Array(bytes);
  return new Blob([copy.buffer]).stream();
}

function createSandbox(initialOutputs: Array<[string, SandboxFile]> = []) {
  const outputs = new Map(initialOutputs);
  const staged = new Map<string, Uint8Array>();
  let currentOutputRoot = "";
  const relativeOutputPath = (path: string) =>
    currentOutputRoot && path.startsWith(`${currentOutputRoot}/`)
      ? path.slice(currentOutputRoot.length + 1)
      : path;
  const deleteFile = vi.fn(async (path: string) => {
    const relative = relativeOutputPath(path);
    for (const key of outputs.keys()) {
      if (relativeOutputPath(key) === relative) outputs.delete(key);
    }
    return { path, success: true };
  });
  const mkdir = vi.fn(async () => ({ success: true }));
  const stop = vi.fn(async () => undefined);
  const writeFile = vi.fn(async (path: string, content: unknown) => {
    staged.set(path, await bodyBytes(content));
    return { success: true, path };
  });
  const exec = vi.fn(async (script: string, _options?: unknown) => ({
    command: script,
    duration: 23,
    exitCode: 0,
    stderr: "",
    stdout: "done\n",
    success: true,
    timestamp: createdAt
  }));
  const listFiles = vi.fn(async (path: string) => {
    currentOutputRoot = path;
    return {
      count: outputs.size,
      files: [...outputs.entries()].map(([storedPath, file]) => {
        const relativePath = relativeOutputPath(storedPath);
        return {
          absolutePath: `${path}/${relativePath}`,
          modifiedAt: createdAt,
          mode: "0644",
          name: relativePath.split("/").at(-1) ?? "file",
          permissions: { executable: false, readable: true, writable: true },
          relativePath,
          size: file.reportedSize ?? file.bytes.byteLength,
          type: file.type ?? "file"
        };
      }),
      path,
      success: true,
      timestamp: createdAt
    };
  });
  const readFile = vi.fn(async (path: string) => {
    const relative = relativeOutputPath(path);
    const file = [...outputs.entries()].find(
      ([storedPath]) => relativeOutputPath(storedPath) === relative
    )?.[1];
    if (!file) throw new Error("FILE_NOT_FOUND");
    return {
      content: byteStream(file.bytes),
      mimeType: file.mimeType,
      path,
      size: file.bytes.byteLength,
      success: true,
      timestamp: createdAt
    };
  });
  const exists = vi.fn(async (path: string) => ({
    exists: outputs.has(path),
    path,
    success: true,
    timestamp: createdAt
  }));
  return {
    deleteFile,
    exec,
    listFiles,
    outputs,
    readFile,
    staged,
    stop,
    stub: {
      deleteFile,
      exec,
      exists,
      listFiles,
      mkdir,
      readFile,
      stop,
      writeFile
    } as unknown as LinuxSandbox,
    writeFile
  };
}

async function executeTool(
  tool: ToolSet[string],
  input: unknown,
  abortSignal?: AbortSignal
): Promise<unknown> {
  if (!tool.execute) throw new Error("Tool is not executable");
  return await tool.execute(input, {
    abortSignal,
    context: undefined,
    messages: [],
    toolCallId: "tool-call-1"
  });
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function options(input: {
  bucket: ArtifactBucket;
  catalog: ArtifactCatalog;
  sandbox: LinuxSandbox;
}): LinuxBashOptions {
  return {
    botId: "bot-1",
    bucket: input.bucket,
    catalog: input.catalog,
    sandbox: () => input.sandbox
  };
}

describe("generic Linux shell", () => {
  it("rejects command instead of silently rewriting it to script", () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const bash = createLinuxBashTool(options({ bucket, catalog, sandbox: runtime.stub }));

    expect(() => (bash.inputSchema as z.ZodType).parse({ command: "pwd" })).toThrow(
      /bash requires the script field.*Valid example/u
    );
  });

  it("rejects the removed background mode with a valid current example", () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const bash = createLinuxBashTool(options({ bucket, catalog, sandbox: runtime.stub }));

    expect(() =>
      (bash.inputSchema as z.ZodType).parse({ background: true, script: "sleep 10" })
    ).toThrow(/bash accepts only script.*Valid example/u);
  });

  it("directs detached monitoring work to a routine", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const bash = createLinuxBashTool(options({ bucket, catalog, sandbox: runtime.stub }));

    await expect(
      executeTool(bash, { script: "nohup bash -c 'while true; do check_mail; done' &" })
    ).rejects.toThrow(/use schedule/u);
    expect(runtime.exec).not.toHaveBeenCalled();
  });
  it("runs a script without an implicit file-transfer contract", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const bash = createLinuxBashTool(options({ bucket, catalog, sandbox: runtime.stub }));

    const result = await executeTool(bash, { script: "printf 'done\\n' > report.txt" });

    expect(runtime.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.exec.mock.invocationCallOrder[0] ?? 0
    );
    const scriptEntry = [...runtime.staged.entries()].find(([path]) =>
      path.endsWith("/command.sh")
    );
    expect(scriptEntry).toBeDefined();
    expect(new TextDecoder().decode(scriptEntry?.[1])).toBe("printf 'done\\n' > report.txt\n");
    expect(runtime.exec).toHaveBeenCalledWith("/usr/local/bin/hqbot-run-agent-command", {
      cwd: "/workspace/hqbot",
      env: {
        DISPLAY: ":99",
        HOME: "/workspace/home",
        HQBOT_RESULT_FILE: expect.stringMatching(
          /^\/workspace\/hqbot\/runs\/[a-f0-9-]+\/result\.json$/u
        ),
        HQBOT_SCRIPT_FILE: expect.stringMatching(
          /^\/workspace\/hqbot\/runs\/[a-f0-9-]+\/command\.sh$/u
        ),
        XDG_CACHE_HOME: "/workspace/home/.cache",
        XDG_CONFIG_HOME: "/workspace/home/.config",
        XDG_DATA_HOME: "/workspace/home/.local/share",
        XDG_RUNTIME_DIR: "/tmp/hqbot-runtime"
      },
      timeout: 60_000
    });
    expect(runtime.exec.mock.calls[0]?.[1]).not.toHaveProperty("signal");
    expect(runtime.exec).toHaveBeenLastCalledWith(
      expect.stringMatching(/^rm -rf -- '\/workspace\/hqbot\/runs\/[a-f0-9-]+'$/u),
      { cwd: "/workspace/hqbot", timeout: 5_000 }
    );
    expect(result).toEqual({
      durationMs: 23,
      exitCode: 0,
      files: [],
      stderr: "",
      stdout: "done\n",
      type: "sandbox_command"
    });
  });

  it("prepares one stable run before it hands a command to its supervisor", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const beforeExec = vi.fn(async () => undefined);
    const startProcess = vi.fn<NonNullable<LinuxBashOptions["startProcess"]>>(async () => ({
      processId: "process-1",
      state: "running",
      taskId: "task-1",
      type: "sandbox_process"
    }));
    const bash = createLinuxBashTool({
      ...options({ bucket, catalog, sandbox: runtime.stub }),
      beforeExec,
      startProcess
    });

    await expect(executeTool(bash, { script: "sleep 120" })).resolves.toEqual({
      processId: "process-1",
      state: "running",
      taskId: "task-1",
      type: "sandbox_process"
    });

    expect(startProcess).toHaveBeenCalledOnce();
    const handoff = startProcess.mock.calls[0]?.[0];
    if (!handoff) throw new Error("The durable run was not handed off");
    expect(handoff).toMatchObject({
      fingerprint: JSON.stringify({ script: "sleep 120" }),
      toolCallId: "tool-call-1",
      run: {
        outputRoot: `${handoff.run.runRoot}/output`,
        outputs: [],
        scriptPath: `${handoff.run.runRoot}/command.sh`,
        staged: []
      }
    });
    expect(new TextDecoder().decode(runtime.staged.get(handoff.run.scriptPath))).toBe(
      "sleep 120\n"
    );
    expect(beforeExec.mock.invocationCallOrder[0]).toBeLessThan(
      startProcess.mock.invocationCallOrder[0] ?? 0
    );
    expect(runtime.exec).not.toHaveBeenCalled();
  });

  it("adopts a replayed process before it touches the computer", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const acquireSandbox = vi.fn(async () => runtime.stub);
    const resumeProcess = vi.fn(async () => ({
      processId: "process-1",
      state: "running" as const,
      taskId: "task-1",
      type: "sandbox_process" as const
    }));
    const bash = createLinuxBashTool({
      ...options({ bucket, catalog, sandbox: runtime.stub }),
      acquireSandbox,
      resumeProcess
    });

    await expect(executeTool(bash, { script: "sleep 10" })).resolves.toMatchObject({
      processId: "process-1",
      type: "sandbox_process"
    });

    expect(resumeProcess).toHaveBeenCalledWith({
      fingerprint: JSON.stringify({ script: "sleep 10" }),
      toolCallId: "tool-call-1"
    });
    expect(acquireSandbox).not.toHaveBeenCalled();
    expect(runtime.writeFile).not.toHaveBeenCalled();
  });

  it("runs only one Bash call at a time for one teammate", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const firstStarted = deferred<void>();
    const finishFirst = deferred<void>();
    let commandCount = 0;
    runtime.exec.mockImplementation(async (command: string) => {
      if (command === "/usr/local/bin/hqbot-run-agent-command") {
        commandCount += 1;
        if (commandCount === 1) {
          firstStarted.resolve();
          await finishFirst.promise;
        }
      }
      return {
        command,
        duration: 23,
        exitCode: 0,
        stderr: "",
        stdout: "done\n",
        success: true,
        timestamp: createdAt
      };
    });
    const acquireSandbox = vi.fn(async () => runtime.stub);
    const firstBash = createLinuxBashTool({
      ...options({ bucket, catalog, sandbox: runtime.stub }),
      acquireSandbox
    });
    const secondBash = createLinuxBashTool({
      ...options({ bucket, catalog, sandbox: runtime.stub }),
      acquireSandbox
    });

    const first = executeTool(firstBash, { script: "first" });
    await firstStarted.promise;
    const second = executeTool(secondBash, { script: "second" });
    await Promise.resolve();

    expect(acquireSandbox).toHaveBeenCalledOnce();
    finishFirst.resolve();
    await Promise.all([first, second]);
    expect(acquireSandbox).toHaveBeenCalledTimes(2);
    expect(commandCount).toBe(2);
    expect(runtime.writeFile).toHaveBeenCalledTimes(2);
  });

  it("releases the Bash tail but rejects a new call before staging while a process runs", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const handoffStarted = deferred<void>();
    const finishHandoff = deferred<void>();
    const acquireSandbox = vi.fn(async () => runtime.stub);
    let managed = false;
    const beforeExec = vi.fn(async () => {
      if (managed) throw new Error("A Bash process is running");
    });
    const managedBash = createLinuxBashTool({
      ...options({ bucket, catalog, sandbox: runtime.stub }),
      acquireSandbox,
      beforeExec,
      startProcess: async () => {
        handoffStarted.resolve();
        await finishHandoff.promise;
        managed = true;
        return {
          processId: "process-1",
          state: "running",
          taskId: "task-1",
          type: "sandbox_process"
        };
      }
    });
    const nextBash = createLinuxBashTool({
      ...options({ bucket, catalog, sandbox: runtime.stub }),
      acquireSandbox,
      beforeExec
    });

    const managedCall = executeTool(managedBash, { script: "sleep 120" });
    await handoffStarted.promise;
    const next = executeTool(nextBash, { script: "true" });
    const nextResult = expect(next).rejects.toThrow("A Bash process is running");
    await Promise.resolve();
    expect(acquireSandbox).toHaveBeenCalledOnce();

    finishHandoff.resolve();
    await managedCall;
    await nextResult;
    expect(acquireSandbox).toHaveBeenCalledTimes(2);
    expect(runtime.writeFile).toHaveBeenCalledTimes(1);
  });

  it("cleans a prepared durable run when the call aborts before handoff", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const abort = new AbortController();
    const startProcess = vi.fn();
    let checks = 0;
    const bash = createLinuxBashTool({
      ...options({ bucket, catalog, sandbox: runtime.stub }),
      beforeExec: async () => {
        checks += 1;
        if (checks === 2) abort.abort(new Error("Owner stopped the task"));
      },
      startProcess
    });

    await expect(executeTool(bash, { script: "sleep 120" }, abort.signal)).rejects.toThrow(
      "Owner stopped the task"
    );

    expect(startProcess).not.toHaveBeenCalled();
    expect(runtime.exec).toHaveBeenCalledWith(
      expect.stringMatching(/^rm -rf -- '\/workspace\/hqbot\/runs\/[a-f0-9-]+'$/u),
      { cwd: "/workspace/hqbot", timeout: 5_000 }
    );
  });

  it("cleans only an explicitly rejected durable start", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const rejectedRuntime = createSandbox();
    const rejected = createLinuxBashTool({
      ...options({ bucket, catalog, sandbox: rejectedRuntime.stub }),
      startProcess: async () => {
        throw new LinuxProcessStartRejected("Ownership was not stored");
      }
    });

    await expect(executeTool(rejected, { script: "sleep 120" })).rejects.toThrow(
      "Ownership was not stored"
    );
    expect(rejectedRuntime.exec).toHaveBeenCalledWith(
      expect.stringMatching(/^rm -rf -- '\/workspace\/hqbot\/runs\/[a-f0-9-]+'$/u),
      { cwd: "/workspace/hqbot", timeout: 5_000 }
    );

    const unknownRuntime = createSandbox();
    const unknown = createLinuxBashTool({
      ...options({ bucket, catalog, sandbox: unknownRuntime.stub }),
      startProcess: async () => {
        throw new Error("The start result is unknown");
      }
    });
    await expect(executeTool(unknown, { script: "sleep 120" })).rejects.toThrow(
      "The start result is unknown"
    );
    expect(unknownRuntime.exec).not.toHaveBeenCalled();
  });

  it("returns a failed command result without publishing undeclared files", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    runtime.exec.mockResolvedValueOnce({
      command: "false",
      duration: 7,
      exitCode: 2,
      stderr: "bad input\n",
      stdout: "",
      success: false,
      timestamp: createdAt
    });
    const bash = createLinuxBashTool(options({ bucket, catalog, sandbox: runtime.stub }));

    await expect(executeTool(bash, { script: "false" })).resolves.toEqual({
      durationMs: 7,
      exitCode: 2,
      files: [],
      stderr: "bad input\n",
      stdout: "",
      type: "sandbox_command"
    });
    expect(runtime.listFiles).not.toHaveBeenCalled();
    expect(runtime.readFile).not.toHaveBeenCalled();
  });

  it("does not execute the same failed Bash call twice", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    runtime.exec.mockResolvedValueOnce({
      command: "false",
      duration: 7,
      exitCode: 2,
      stderr: "bad input\n",
      stdout: "",
      success: false,
      timestamp: createdAt
    });
    const bash = createLinuxBashTool(options({ bucket, catalog, sandbox: runtime.stub }));

    await executeTool(bash, { script: "false" });
    const calls = runtime.exec.mock.calls.length;
    await expect(executeTool(bash, { script: "false" })).rejects.toThrow(
      "This exact Bash call already failed"
    );
    expect(runtime.exec).toHaveBeenCalledTimes(calls);
  });

  it("keeps full tool output for the UI but bounds model context", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const bash = createLinuxBashTool(options({ bucket, catalog, sandbox: runtime.stub }));
    if (!bash.toModelOutput) throw new Error("Missing model output mapper");
    const stdout = "x".repeat(20_000);

    const modelOutput = await bash.toModelOutput({
      input: { script: "print" },
      output: {
        durationMs: 1,
        exitCode: 0,
        files: [],
        stderr: "",
        stdout,
        type: "sandbox_command"
      },
      toolCallId: "call-1"
    });

    expect(JSON.stringify(modelOutput).length).toBeLessThan(9_000);
    expect(JSON.stringify(modelOutput)).toContain("model output truncated");
    expect(stdout).toHaveLength(20_000);
  });

  it("stops the computer when command execution fails or times out", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    runtime.exec.mockRejectedValueOnce(new Error("Command timed out"));
    const bash = createLinuxBashTool(options({ bucket, catalog, sandbox: runtime.stub }));

    await expect(executeTool(bash, { script: "sleep 120" })).rejects.toThrow("Command timed out");
    expect(runtime.stop).toHaveBeenCalledOnce();
  });

  it("does not start a command for an already aborted tool call", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const abort = new AbortController();
    abort.abort(new Error("Owner stopped the task"));
    const bash = createLinuxBashTool(options({ bucket, catalog, sandbox: runtime.stub }));

    await expect(executeTool(bash, { script: "sleep 120" }, abort.signal)).rejects.toThrow(
      "Owner stopped the task"
    );
    expect(runtime.exec).not.toHaveBeenCalledWith(
      "/usr/local/bin/hqbot-run-agent-command",
      expect.anything()
    );
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it("records one stable reservation for repeated calls through one tool instance", async () => {
    const { bucket } = createBucket();
    const { catalog } = createCatalog();
    const runtime = createSandbox();
    const recordSandboxUse = vi.fn(async () => undefined);
    const bash = createLinuxBashTool({
      ...options({ bucket, catalog, sandbox: runtime.stub }),
      recordSandboxUse
    });

    await executeTool(bash, { script: "true" });
    await executeTool(bash, { script: "true" });

    expect(recordSandboxUse).toHaveBeenCalledOnce();
    expect(recordSandboxUse).toHaveBeenCalledWith("tool-call-1");
  });

  it("reuses a durable output after finalization resumes without the Sandbox file", async () => {
    const existing = botFile({
      botId: "bot-1",
      contentType: "text/plain",
      id: "file-1",
      key: "files/bot-1/file-1/result.txt",
      name: "result.txt",
      size: 4
    });
    const { bucket } = createBucket();
    const { catalog } = createCatalog([existing]);
    const runtime = createSandbox();

    await expect(
      publishLinuxOutputs(
        { botId: "bot-1", bucket, catalog, sandbox: runtime.stub },
        "/workspace/hqbot/runs/run-1/output",
        [
          {
            absolutePath: "/workspace/hqbot/runs/run-1/output/result.txt",
            fileId: "file-1",
            name: "result.txt",
            relativePath: "result.txt"
          }
        ]
      )
    ).resolves.toEqual([
      {
        botId: "bot-1",
        contentType: "text/plain",
        createdAt,
        id: "file-1",
        name: "result.txt",
        size: 4
      }
    ]);
    expect(runtime.listFiles).not.toHaveBeenCalled();
    expect(runtime.readFile).not.toHaveBeenCalled();
  });

  it("counts existing and newly published outputs once when finalization resumes", async () => {
    const existing = botFile({
      botId: "bot-1",
      contentType: "application/octet-stream",
      id: "existing-file",
      key: "files/bot-1/existing-file/existing.bin",
      name: "existing.bin",
      size: 9_000_000
    });
    const runtime = createSandbox([
      ["new.bin", { bytes: new Uint8Array(9_000_000), mimeType: "application/octet-stream" }]
    ]);
    const { bucket } = createBucket();
    const { catalog } = createCatalog([existing]);

    await expect(
      publishLinuxOutputs(
        { botId: "bot-1", bucket, catalog, sandbox: runtime.stub },
        "/workspace/hqbot/runs/run-1/output",
        [
          {
            absolutePath: "/workspace/hqbot/runs/run-1/output/existing.bin",
            fileId: "existing-file",
            name: "existing.bin",
            relativePath: "existing.bin"
          },
          {
            absolutePath: "/workspace/hqbot/runs/run-1/output/new.bin",
            fileId: "new-file",
            name: "new.bin",
            relativePath: "new.bin"
          }
        ]
      )
    ).resolves.toHaveLength(2);
  });
});
