import { getSandbox, type Process, type Sandbox } from "@cloudflare/sandbox";

export const DESKTOP_PORT = 6080;
export const COMPUTER_CHECKPOINT_KEY = (botId: string) =>
  `teammates/${botId}/computer/workspace.tar.gz`;

export const COMPUTER_IDLE_SECONDS = 30 * 60;
const STANDARD_ONE_USD_PER_SECOND = 4 * 0.0000025 + 0.5 * 0.00002 + 8 * 0.00000007;
const DESKTOP_COMMAND = "/usr/local/bin/hqbot-desktop";
const DESKTOP_PROCESS_ID = "hqbot-desktop";
const RESOURCE_COMMAND = "/usr/local/bin/hqbot-computer-resources";
const CHECKPOINT_PATH = "/tmp/hqbot-workspace.tar.gz";
const PREPARED_PATH = "/tmp/hqbot-computer-prepared";
const RUNNING_PROCESS_STATES = new Set(["running", "starting"]);

export interface LinuxDesktopSession {
  webSocketPath: string;
}

export interface ComputerResources {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number | null;
  diskBytes: number;
  diskLimitBytes: number | null;
  uptimeSeconds: number;
  estimatedCostUsd: number;
  updatedAt: string;
}

interface ResourceSample {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number | null;
  diskBytes: number;
  diskLimitBytes: number | null;
}

interface CheckpointBucket {
  delete(key: string): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  put(
    key: string,
    body: ReadableStream,
    options: { httpMetadata: { contentType: string } }
  ): Promise<unknown>;
}

export type LinuxDesktopSandbox = Pick<
  Sandbox,
  | "cleanupCompletedProcesses"
  | "deleteFile"
  | "destroy"
  | "exec"
  | "exists"
  | "getProcess"
  | "readFile"
  | "setKeepAlive"
  | "startProcess"
  | "stop"
  | "writeFile"
  | "wsConnect"
>;

export function estimateComputerMicroUsd(seconds: number): number {
  return Math.round(Math.max(0, seconds) * STANDARD_ONE_USD_PER_SECOND * 1_000_000);
}

export function teammateSandbox(env: Env, botId: string): Sandbox {
  return getSandbox(env.SANDBOX, `desktop-${botId}`, {
    enableDefaultSession: true,
    keepAlive: true,
    labels: { product: "hqbot", teammate: botId },
    normalizeId: true,
    sleepAfter: "30m",
    transport: "rpc"
  });
}

async function readyProcess(sandbox: LinuxDesktopSandbox): Promise<Process> {
  const current = await sandbox.getProcess(DESKTOP_PROCESS_ID);
  if (current && RUNNING_PROCESS_STATES.has(await current.getStatus())) return current;
  await sandbox.cleanupCompletedProcesses();
  return sandbox.startProcess(DESKTOP_COMMAND, {
    autoCleanup: false,
    processId: DESKTOP_PROCESS_ID
  });
}

export async function openLinuxDesktop(
  sandbox: LinuxDesktopSandbox,
  botId: string
): Promise<LinuxDesktopSession> {
  const process = await readyProcess(sandbox);
  await process.waitForPort(DESKTOP_PORT, { mode: "tcp", timeout: 60_000 });
  return { webSocketPath: `/api/bots/${encodeURIComponent(botId)}/desktop/ws` };
}

export async function connectLinuxDesktop(
  sandbox: LinuxDesktopSandbox,
  botId: string,
  request: Request
): Promise<Response> {
  await openLinuxDesktop(sandbox, botId);
  return sandbox.wsConnect(request, DESKTOP_PORT);
}

export async function setLinuxDesktopOwnerControl(
  sandbox: LinuxDesktopSandbox,
  active: boolean
): Promise<void> {
  const result = await sandbox.exec(
    `x11vnc -display :99 -sync -R ${active ? "noviewonly" : "viewonly"}`,
    { timeout: 5_000 }
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Computer control could not change");
  }
}

export async function isComputerPrepared(sandbox: LinuxDesktopSandbox): Promise<boolean> {
  return (await sandbox.exists(PREPARED_PATH)).exists;
}

export async function restoreComputer(
  sandbox: LinuxDesktopSandbox,
  bucket: CheckpointBucket,
  botId: string
): Promise<{ restored: boolean; size: number }> {
  const checkpoint = await bucket.get(COMPUTER_CHECKPOINT_KEY(botId));
  if (!checkpoint) {
    await sandbox.exec(`mkdir -p /workspace/hqbot && touch ${PREPARED_PATH}`);
    return { restored: false, size: 0 };
  }
  await sandbox.writeFile(CHECKPOINT_PATH, checkpoint.body);
  try {
    const result = await sandbox.exec(
      `mkdir -p /workspace && tar -xzf ${CHECKPOINT_PATH} -C /workspace && touch ${PREPARED_PATH}`,
      { timeout: 120_000 }
    );
    if (result.exitCode !== 0) {
      await bucket.delete(COMPUTER_CHECKPOINT_KEY(botId)).catch(() => undefined);
      const clean = await sandbox.exec(
        `find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && mkdir -p /workspace/hqbot && touch ${PREPARED_PATH}`,
        { timeout: 120_000 }
      );
      if (clean.exitCode !== 0) throw new Error("A clean computer workspace could not be created");
      return { restored: false, size: 0 };
    }
    return { restored: true, size: checkpoint.size };
  } finally {
    await sandbox.deleteFile(CHECKPOINT_PATH).catch(() => undefined);
  }
}

export async function checkpointComputer(
  sandbox: LinuxDesktopSandbox,
  bucket: CheckpointBucket,
  botId: string,
  clean: boolean
): Promise<{ size: number }> {
  if (clean) {
    await sandbox
      .exec("pkill -TERM -f '[g]oogle-chrome' || true; sleep 1", { timeout: 5_000 })
      .catch(() => undefined);
  }
  const result = await sandbox.exec(
    `tar --ignore-failed-read --exclude='./chrome/Singleton*' --exclude='./chrome/*/Cache' --exclude='./chrome/*/Code Cache' -czf ${CHECKPOINT_PATH} -C /workspace .`,
    { timeout: 120_000 }
  );
  try {
    if (result.exitCode !== 0) throw new Error("The computer checkpoint could not be created");
    const file = await sandbox.readFile(CHECKPOINT_PATH, { encoding: "none" });
    await bucket.put(COMPUTER_CHECKPOINT_KEY(botId), file.content, {
      httpMetadata: { contentType: "application/gzip" }
    });
    return { size: file.size };
  } finally {
    await sandbox.deleteFile(CHECKPOINT_PATH).catch(() => undefined);
  }
}

export function parseComputerResourceSample(value: string): ResourceSample {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid computer resource sample");
  const source = parsed as Record<string, unknown>;
  const number = (key: string, nullable = false): number | null => {
    const candidate = source[key];
    if (nullable && candidate === null) return null;
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
      throw new Error("Invalid computer resource sample");
    }
    return candidate;
  };
  return {
    cpuPercent: number("cpuPercent") as number,
    memoryBytes: number("memoryBytes") as number,
    memoryLimitBytes: number("memoryLimitBytes", true),
    diskBytes: number("diskBytes") as number,
    diskLimitBytes: number("diskLimitBytes", true)
  };
}

export async function readComputerResources(
  sandbox: LinuxDesktopSandbox,
  startedAt: number
): Promise<ComputerResources> {
  const result = await sandbox.exec(RESOURCE_COMMAND, { timeout: 5_000 });
  if (result.exitCode !== 0) throw new Error("Computer resources are not available");
  const sample = parseComputerResourceSample(result.stdout);
  const uptimeSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1_000));
  return {
    ...sample,
    uptimeSeconds,
    estimatedCostUsd: estimateComputerMicroUsd(uptimeSeconds) / 1_000_000,
    updatedAt: new Date().toISOString()
  };
}

export async function stopLinuxComputer(sandbox: LinuxDesktopSandbox): Promise<void> {
  await sandbox.setKeepAlive(false).catch(() => undefined);
  await sandbox.stop();
}
