import type { ComputerStorage } from "./computer-types";
import { checkpointComputer, type LinuxDesktopSandbox } from "./desktop";

interface BackupBucket {
  list(input: { prefix: string; cursor?: string }): Promise<{
    objects: { key: string; size: number; uploaded: Date }[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string[]): Promise<unknown>;
}

export const CHECKPOINT_STATE_KEY = "hqbot:computer:checkpoint";
export const BACKUP_PREFIX = (botId: string) => `teammates/${botId}/computer/backups/`;
export function backupKey(botId: string, id: string): string {
  if (!/^[0-9T:.Z-]+-[a-f0-9-]+\.tar\.gz$/u.test(id) || id.includes(".."))
    throw new Error("Invalid backup ID");
  return BACKUP_PREFIX(botId) + id;
}
export async function listComputerBackups(bucket: BackupBucket, botId: string) {
  const objects: { key: string; size: number; uploaded: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: BACKUP_PREFIX(botId), cursor });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((object) => ({
      id: object.key.slice(BACKUP_PREFIX(botId).length),
      size: object.size,
      createdAt: object.uploaded.toISOString()
    }));
}
export async function pruneComputerBackups(
  bucket: BackupBucket,
  botId: string,
  preserveId?: string
): Promise<void> {
  const backups = await listComputerBackups(bucket, botId);
  const old = backups
    .slice(10)
    .filter((item) => item.id !== preserveId)
    .map((item) => backupKey(botId, item.id));
  if (old.length) await bucket.delete(old);
}
export async function saveComputerCheckpoint(input: {
  sandbox: LinuxDesktopSandbox;
  bucket: Env["ARTIFACTS"];
  storage: ComputerStorage;
  botId: string;
  clean: boolean;
  preserveId?: string;
}): Promise<void> {
  try {
    const result = await checkpointComputer(input.sandbox, input.bucket, input.botId, input.clean);
    await input.storage.put(CHECKPOINT_STATE_KEY, {
      size: result.size,
      updatedAt: new Date().toISOString()
    });
    // Retention failure does not invalidate a newly saved backup.
    if (typeof input.bucket.list === "function")
      await pruneComputerBackups(input.bucket, input.botId, input.preserveId).catch(
        () => undefined
      );
  } catch (cause) {
    const previous = await input.storage.get<Record<string, unknown>>(CHECKPOINT_STATE_KEY);
    await input.storage.put(CHECKPOINT_STATE_KEY, {
      ...previous,
      error: "The computer backup failed. The previous saved backup is unchanged.",
      failedAt: new Date().toISOString()
    });
    throw cause;
  }
}
