import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import type { BotFile } from "../../src/domain/types";
import type { TeammateComputer } from "../../src/runtime/computer";
import { createComputerFileTools } from "../../src/runtime/computer-files";
import type { WorkspaceAgentRpc } from "../../src/runtime/types";
import type { ArtifactBucket } from "../../src/services/artifacts";

const createdAt = "2026-09-02T12:00:00.000Z";

async function execute(tool: ToolSet[string], input: unknown): Promise<unknown> {
  if (!tool.execute) throw new Error("Tool is not executable");
  return tool.execute(input, {
    abortSignal: undefined,
    context: undefined,
    messages: [],
    toolCallId: "file-call-1"
  });
}

function bytes(value: unknown): Promise<Uint8Array> {
  return new Response(value as BodyInit).arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function harness(initialFiles: BotFile[] = [], initialObjects: Array<[string, Uint8Array]> = []) {
  const files = [...initialFiles];
  const objects = new Map(initialObjects);
  const createFile = vi.fn(async (input: Parameters<WorkspaceAgentRpc["createFile"]>[0]) => {
    const file = { ...input, createdAt, taskId: null };
    files.unshift(file);
    return file;
  });
  const deleteFile = vi.fn(async (id: string, botId: string) => {
    const index = files.findIndex((file) => file.id === id && file.botId === botId);
    return index < 0 ? null : (files.splice(index, 1)[0] ?? null);
  });
  const catalog = {
    createFile,
    deleteFile,
    getFile: vi.fn(async (id: string, botId: string) =>
      files.find((file) => file.id === id && file.botId === botId)
    ),
    listFiles: vi.fn(async (botId: string) => files.filter((file) => file.botId === botId))
  } as unknown as WorkspaceAgentRpc;
  const bucket = {
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
    get: vi.fn(async (key: string) => {
      const value = objects.get(key);
      return value
        ? {
            bytes: async () => new Uint8Array(value),
            text: async () => new TextDecoder().decode(value)
          }
        : null;
    }),
    put: vi.fn(async (key: string, value: unknown) => {
      objects.set(key, await bytes(value));
    })
  } satisfies ArtifactBucket;
  const fileBytes = new Uint8Array([1, 2, 3]);
  const sandbox = {
    exec: vi.fn(async (command: string) => ({
      duration: 1,
      exitCode: 0,
      stderr: "",
      stdout: command.includes("copy.pdf")
        ? "/workspace/hqbot/copy.pdf\n"
        : "/workspace/hqbot/report.pdf\n"
    })),
    listFiles: vi.fn(async () => ({
      files: [
        {
          absolutePath: "/workspace/hqbot/report.pdf",
          size: fileBytes.byteLength,
          type: "file"
        }
      ]
    })),
    mkdir: vi.fn(async (_path: string, _options: { recursive: boolean }) => undefined),
    readFile: vi.fn(async () => ({
      content: new Blob([fileBytes]).stream(),
      mimeType: "application/pdf",
      size: fileBytes.byteLength
    })),
    writeFile: vi.fn(async (_path: string, _content: ReadableStream<Uint8Array>) => undefined)
  };
  const computer = {
    acquire: vi.fn(async () => sandbox),
    assertModelControlAvailable: vi.fn(async () => undefined)
  } as unknown as TeammateComputer;
  const tools = createComputerFileTools({
    botId: "bot-1",
    bucket,
    catalog,
    computer,
    taskId: () => null
  });
  return { bucket, catalog, computer, fileBytes, files, objects, sandbox, tools };
}

describe("computer file tools", () => {
  it("returns current usage when file-tool input is invalid", () => {
    const runtime = harness();

    expect(() =>
      (runtime.tools.copy_file_to_computer.inputSchema as z.ZodType).parse({ path: "note.txt" })
    ).toThrow(/fileId/u);
    expect(() =>
      (runtime.tools.delete_file.inputSchema as z.ZodType).parse({ path: "note.txt" })
    ).toThrow(/delete_file accepts only fileId/u);
    expect(() => (runtime.tools.list_files.inputSchema as z.ZodType).parse({ all: true })).toThrow(
      /list_files accepts only \{\}/u
    );
  });

  it("uploads one computer file to durable Files idempotently", async () => {
    const runtime = harness();

    const first = await execute(runtime.tools.upload_file, {
      path: "/workspace/hqbot/report.pdf"
    });
    const second = await execute(runtime.tools.upload_file, {
      path: "/workspace/hqbot/report.pdf"
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      file: { contentType: "application/pdf", name: "report.pdf", size: 3 },
      status: "saved"
    });
    expect(runtime.bucket.put).toHaveBeenCalledOnce();
    expect(runtime.catalog.createFile).toHaveBeenCalledOnce();
    expect(runtime.computer.acquire).toHaveBeenCalledOnce();
  });

  it("copies one durable file back to the computer", async () => {
    const file: BotFile = {
      botId: "bot-1",
      contentType: "application/pdf",
      createdAt,
      id: "file-1",
      key: "files/bot-1/file-1/report.pdf",
      name: "report.pdf",
      size: 3,
      taskId: null
    };
    const runtime = harness([file], [[file.key, new Uint8Array([4, 5, 6])]]);

    await expect(
      execute(runtime.tools.copy_file_to_computer, {
        fileId: file.id,
        path: "/workspace/hqbot/copy.pdf"
      })
    ).resolves.toEqual({
      fileId: file.id,
      path: "/workspace/hqbot/copy.pdf",
      size: 3,
      status: "copied"
    });
    expect(runtime.sandbox.mkdir).toHaveBeenCalledWith("/workspace/hqbot", {
      recursive: true
    });
    const written = runtime.sandbox.writeFile.mock.calls[0]?.[1];
    expect(written).toBeInstanceOf(ReadableStream);
    expect(await bytes(written)).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("lists and deletes only this teammate's durable files", async () => {
    const own: BotFile = {
      botId: "bot-1",
      contentType: "text/plain",
      createdAt,
      id: "own",
      key: "files/bot-1/own/note.txt",
      name: "note.txt",
      size: 1,
      taskId: null
    };
    const foreign = { ...own, botId: "bot-2", id: "foreign" };
    const runtime = harness([own, foreign], [[own.key, new Uint8Array([1])]]);

    await expect(execute(runtime.tools.list_files, {})).resolves.toMatchObject({
      files: [{ id: "own" }]
    });
    await expect(execute(runtime.tools.delete_file, { fileId: "own" })).resolves.toEqual({
      deleted: true,
      fileId: "own"
    });
    expect(runtime.bucket.delete).toHaveBeenCalledWith(own.key);
    expect(runtime.files).toEqual([foreign]);
  });

  it("rejects paths outside the teammate workspace before opening the computer", async () => {
    const runtime = harness();

    await expect(
      execute(runtime.tools.upload_file, { path: "/workspace/home/chrome/Cookies" })
    ).rejects.toThrow("path must be an absolute file path under /workspace/hqbot");
    expect(runtime.computer.acquire).not.toHaveBeenCalled();
  });

  it("rejects a workspace symlink that resolves outside the workspace", async () => {
    const runtime = harness();
    runtime.sandbox.exec.mockResolvedValueOnce({
      duration: 1,
      exitCode: 0,
      stderr: "",
      stdout: "/workspace/home/secret.txt\n"
    });

    await expect(
      execute(runtime.tools.upload_file, { path: "/workspace/hqbot/link.txt" })
    ).rejects.toThrow("path must be an absolute file path under /workspace/hqbot");
  });
});
