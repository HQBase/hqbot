import type { Sandbox } from "@cloudflare/sandbox";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

import { contentTypeForUpload, safeFileName } from "../domain/files";
import { artifactReference, deleteArtifact, saveArtifact } from "../services/artifacts";
import type { TeammateComputer } from "./computer";
import { LINUX_WORKSPACE } from "./linux-run";
import type { WorkspaceAgentRpc } from "./types";

const MAX_FILE_BYTES = 10_000_000;
const filePathExample = `{"path":"${LINUX_WORKSPACE}/report.pdf"}`;
const copyExample = '{"fileId":"file-123"}';
const deleteExample = '{"fileId":"file-123"}';

interface ComputerFileToolsOptions {
  botId: string;
  bucket: Env["ARTIFACTS"];
  catalog: WorkspaceAgentRpc;
  computer: TeammateComputer;
  taskId: () => unknown;
}

function workspacePath(value: string): string {
  if (
    !value.startsWith(`${LINUX_WORKSPACE}/`) ||
    value.includes("\\") ||
    value.includes("\0") ||
    value
      .slice(LINUX_WORKSPACE.length + 1)
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`path must be an absolute file path under ${LINUX_WORKSPACE}`);
  }
  return value;
}

function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function realWorkspacePath(sandbox: Sandbox, path: string, missing = false): Promise<string> {
  const result = await sandbox.exec(
    `${missing ? "realpath -m" : "realpath"} -- ${shellQuote(path)}`,
    {
      cwd: LINUX_WORKSPACE,
      timeout: 5_000
    }
  );
  if (result.exitCode !== 0) throw new Error(`File not found: ${path}`);
  return workspacePath(result.stdout.trim());
}

async function stableFileId(botId: string, toolCallId: string, path: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${botId}\u0000${toolCallId}\u0000${path}`)
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `tool-${hex.slice(0, 32)}`;
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer]).stream();
}

async function acquireComputer(
  options: ComputerFileToolsOptions,
  toolCallId: string
): Promise<Sandbox> {
  await options.computer.assertModelControlAvailable();
  const taskId = options.taskId();
  const sandbox = await options.computer.acquire({
    eventId: `file:${toolCallId}`,
    taskId: typeof taskId === "string" ? taskId : null
  });
  await options.computer.assertModelControlAvailable();
  return sandbox;
}

function modelText(value: unknown) {
  return { type: "text" as const, value: JSON.stringify(value) };
}

export function createComputerFileTools(options: ComputerFileToolsOptions): ToolSet {
  const upload = tool({
    description: `Save one file from the teammate's computer to durable Files in R2 so the owner can download it. The path must be under ${LINUX_WORKSPACE}. Valid example: ${filePathExample}`,
    inputSchema: z.strictObject(
      {
        path: z
          .string({ error: `upload_file requires path. Valid example: ${filePathExample}` })
          .min(1)
          .max(1_000),
        name: z.string().min(1).max(120).optional()
      },
      { error: `upload_file accepts path and optional name. Valid example: ${filePathExample}` }
    ),
    execute: async ({ name: requestedName, path: requestedPath }, context) => {
      const path = workspacePath(requestedPath);
      const id = await stableFileId(options.botId, context.toolCallId, path);
      const existing = await options.catalog.getFile(id, options.botId);
      if (existing) return { file: artifactReference(existing), status: "saved" as const };
      const sandbox = await acquireComputer(options, context.toolCallId);
      const realPath = await realWorkspacePath(sandbox, path);
      const listing = await sandbox.listFiles(parentPath(realPath), { recursive: false });
      const entry = listing.files.find((file) => file.absolutePath === realPath);
      if (entry?.type !== "file") throw new Error(`File not found: ${path}`);
      if (entry.size <= 0 || entry.size > MAX_FILE_BYTES) {
        throw new Error("Files must contain 1 byte to 10 MB");
      }
      const result = await sandbox.readFile(realPath, { encoding: "none" });
      const bytes = new Uint8Array(await new Response(result.content).arrayBuffer());
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_FILE_BYTES) {
        throw new Error("Files must contain 1 byte to 10 MB");
      }
      const name = safeFileName(requestedName ?? realPath.split("/").at(-1) ?? "attachment");
      const file = await saveArtifact({
        body: bytes,
        botId: options.botId,
        bucket: options.bucket,
        catalog: options.catalog,
        contentType: contentTypeForUpload(name, result.mimeType),
        id,
        name,
        size: bytes.byteLength
      });
      return { file: artifactReference(file), status: "saved" as const };
    },
    toModelOutput: ({ output }) => modelText(output)
  });

  const copyToComputer = tool({
    description: `Copy one durable Files/R2 file to this teammate's computer. The destination must be under ${LINUX_WORKSPACE}. Omit path to use the file name in that directory. Valid example: ${copyExample}`,
    inputSchema: z.strictObject(
      {
        fileId: z.string({ error: copyExample }).min(1).max(100),
        path: z.string().min(1).max(1_000).optional()
      },
      { error: `copy_file_to_computer accepts fileId and optional path. ${copyExample}` }
    ),
    execute: async ({ fileId, path: requestedPath }, context) => {
      const file = await options.catalog.getFile(fileId, options.botId);
      if (!file) throw new Error(`File ${fileId} is not available to this teammate`);
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
        throw new Error("Files must contain 1 byte to 10 MB");
      }
      const object = await options.bucket.get(file.key);
      if (!object) throw new Error(`File ${file.name} is no longer available`);
      const path = workspacePath(requestedPath ?? `${LINUX_WORKSPACE}/${safeFileName(file.name)}`);
      const sandbox = await acquireComputer(options, context.toolCallId);
      const realPath = await realWorkspacePath(sandbox, path, true);
      await sandbox.mkdir(parentPath(realPath), { recursive: true });
      const bytes = await object.bytes();
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_FILE_BYTES) {
        throw new Error("Files must contain 1 byte to 10 MB");
      }
      await sandbox.writeFile(realPath, byteStream(bytes));
      return { fileId, path: realPath, size: bytes.byteLength, status: "copied" as const };
    },
    toModelOutput: ({ output }) => modelText(output)
  });

  const remove = tool({
    description: `Delete one durable file from this teammate's Files list and R2. This does not delete a local computer file. Valid example: ${deleteExample}`,
    inputSchema: z.strictObject(
      { fileId: z.string({ error: deleteExample }).min(1).max(100) },
      { error: `delete_file accepts only fileId. ${deleteExample}` }
    ),
    execute: async ({ fileId }) => {
      const file = await options.catalog.getFile(fileId, options.botId);
      if (!file) return { deleted: false, fileId };
      await deleteArtifact(options.bucket, options.catalog, file);
      return { deleted: true, fileId };
    },
    toModelOutput: ({ output }) => modelText(output)
  });

  const list = tool({
    description: "List durable files available to this teammate. Valid input: {}",
    inputSchema: z.strictObject({}, { error: "list_files accepts only {}" }),
    execute: async () => ({
      files: (await options.catalog.listFiles(options.botId)).map(artifactReference)
    }),
    toModelOutput: ({ output }) => modelText(output)
  });

  return {
    copy_file_to_computer: copyToComputer,
    delete_file: remove,
    list_files: list,
    upload_file: upload
  };
}
