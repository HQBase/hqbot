import type { ArtifactBucket, ArtifactCatalog } from "../services/artifacts";

export const LINUX_WORKSPACE = "/workspace/hqbot";
export const LINUX_HOME = "/workspace/home";
export const LINUX_RUNS = `${LINUX_WORKSPACE}/runs`;
export const LINUX_RUNNER_COMMAND = "/usr/local/bin/hqbot-run-agent-command";
export const LINUX_RESULT_NAME = "result.json";

const CLEANUP_TIMEOUT_MS = 5_000;

interface SandboxFileInfo {
  absolutePath: string;
  size: number;
  type: "file" | "directory" | "symlink" | "other";
}

export interface LinuxSandbox {
  deleteFile(path: string): Promise<unknown>;
  exec(
    command: string,
    options: {
      cwd: string;
      env?: Record<string, string>;
      timeout: number;
    }
  ): Promise<{
    duration: number;
    exitCode: number;
    stderr: string;
    stdout: string;
  }>;
  listFiles(path: string, options: { recursive: boolean }): Promise<{ files: SandboxFileInfo[] }>;
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  readFile(
    path: string,
    options: { encoding: "none" }
  ): Promise<{
    content: ReadableStream<Uint8Array>;
    mimeType: string;
    size: number;
  }>;
  writeFile(path: string, content: ReadableStream<Uint8Array>): Promise<unknown>;
  stop(): Promise<void>;
}

export interface LinuxProcessCompletion {
  durationMs: number;
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface PreparedLinuxRun {
  outputRoot: string;
  outputs: LinuxOutputSpec[];
  runRoot: string;
  scriptPath: string;
  staged: string[];
}

export interface LinuxOutputSpec {
  absolutePath: string;
  fileId: string;
  name: string;
  relativePath: string;
}

export interface LinuxRunOptions {
  acquireSandbox?: (toolCallId: string) => Promise<LinuxSandbox>;
  beforeExec?: () => Promise<void>;
  botId: string;
  bucket: ArtifactBucket;
  catalog: ArtifactCatalog;
  recordSandboxUse?: (toolCallId: string) => Promise<void>;
  sandbox: LinuxSandbox;
  stopSandbox?: (checkpoint: boolean) => Promise<void>;
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer]).stream();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function cleanupLinuxRun(
  options: LinuxRunOptions,
  runRoot: string,
  staged: readonly string[]
): Promise<void> {
  const paths = [runRoot, ...staged].map(shellQuote).join(" ");
  const result = await options.sandbox.exec(`rm -rf -- ${paths}`, {
    cwd: LINUX_WORKSPACE,
    timeout: CLEANUP_TIMEOUT_MS
  });
  if (result.exitCode !== 0) throw new Error("Temporary computer files could not be removed");
}

export async function prepareLinuxRun(
  options: LinuxRunOptions,
  input: { script: string }
): Promise<PreparedLinuxRun> {
  await options.sandbox.mkdir(LINUX_RUNS, { recursive: true });
  const runRoot = `${LINUX_RUNS}/${crypto.randomUUID()}`;
  const outputRoot = `${runRoot}/output`;
  const scriptPath = `${runRoot}/command.sh`;
  await options.sandbox.mkdir(runRoot, { recursive: true });
  try {
    await options.sandbox.writeFile(
      scriptPath,
      bytesStream(new TextEncoder().encode(`${input.script}\n`))
    );
    return { outputRoot, outputs: [], runRoot, scriptPath, staged: [] };
  } catch (cause) {
    await cleanupLinuxRun(options, runRoot, []).catch(() => undefined);
    throw cause;
  }
}

function isLinuxProcessCompletion(value: unknown): value is LinuxProcessCompletion {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.durationMs === "number" &&
    Number.isFinite(result.durationMs) &&
    result.durationMs >= 0 &&
    typeof result.exitCode === "number" &&
    Number.isInteger(result.exitCode) &&
    typeof result.stderr === "string" &&
    typeof result.stdout === "string"
  );
}

export async function readLinuxProcessCompletion(
  sandbox: LinuxSandbox,
  runRoot: string
): Promise<LinuxProcessCompletion | null> {
  const resultPath = `${runRoot}/${LINUX_RESULT_NAME}`;
  const listing = await sandbox.listFiles(runRoot, { recursive: false });
  if (!listing.files.some((file) => file.absolutePath === resultPath && file.type === "file")) {
    return null;
  }
  const file = await sandbox.readFile(resultPath, { encoding: "none" });
  const value: unknown = JSON.parse(await new Response(file.content).text());
  if (!isLinuxProcessCompletion(value)) throw new Error("The Bash completion record is invalid");
  return value;
}

export function linuxProcessOptions(run: PreparedLinuxRun) {
  return {
    command: LINUX_RUNNER_COMMAND,
    options: {
      cwd: LINUX_WORKSPACE,
      env: {
        DISPLAY: ":99",
        HOME: LINUX_HOME,
        HQBOT_RESULT_FILE: `${run.runRoot}/${LINUX_RESULT_NAME}`,
        HQBOT_SCRIPT_FILE: run.scriptPath,
        XDG_CACHE_HOME: `${LINUX_HOME}/.cache`,
        XDG_CONFIG_HOME: `${LINUX_HOME}/.config`,
        XDG_DATA_HOME: `${LINUX_HOME}/.local/share`,
        XDG_RUNTIME_DIR: "/tmp/hqbot-runtime"
      }
    }
  };
}
