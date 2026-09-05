import { expect, it, vi } from "vitest";
import {
  BACKUP_PREFIX,
  backupKey,
  pruneComputerBackups,
  saveComputerCheckpoint
} from "../../src/runtime/computer-backups";

vi.mock("../../src/runtime/desktop", () => ({
  checkpointComputer: vi.fn().mockRejectedValue(new Error("storage unavailable"))
}));
it("retains the chosen restore version while pruning only older backups for this teammate", async () => {
  const prefix = BACKUP_PREFIX("bot");
  const objects = Array.from({ length: 12 }, (_, index) => ({
    key: `${prefix}2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z-abcdef.tar.gz`,
    size: 10,
    uploaded: new Date()
  }));
  const bucket = {
    list: vi.fn().mockResolvedValue({ objects, truncated: false }),
    delete: vi.fn()
  };
  const preserved = objects[0]?.key.slice(prefix.length);
  await pruneComputerBackups(bucket, "bot", preserved);
  expect(bucket.delete).toHaveBeenCalledWith([objects[1]?.key]);
  expect(bucket.list).toHaveBeenCalledWith({ prefix, cursor: undefined });
  expect(() => backupKey("bot", "../other/workspace.tar.gz")).toThrow("Invalid backup");
});
it("keeps the previous checkpoint timestamp and records a visible failure", async () => {
  const put = vi.fn();
  await expect(
    saveComputerCheckpoint({
      sandbox: {} as never,
      bucket: {} as never,
      storage: {
        get: vi.fn().mockResolvedValue({ updatedAt: "previous", size: 123 }),
        put,
        delete: vi.fn()
      },
      botId: "bot",
      clean: false
    })
  ).rejects.toThrow("storage unavailable");
  expect(put).toHaveBeenCalledWith(
    "hqbot:computer:checkpoint",
    expect.objectContaining({
      updatedAt: "previous",
      size: 123,
      error: expect.stringContaining("backup failed")
    })
  );
});
