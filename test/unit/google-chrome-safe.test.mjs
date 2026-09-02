import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const wrapper = fileURLToPath(new URL("../../scripts/google-chrome-safe.sh", import.meta.url));

describe("Chrome command wrapper", () => {
  it("rejects a bare local file path with a correct usage example", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hqbot-chrome-"));
    try {
      await writeFile(path.join(directory, "report.html"), "<h1>Report</h1>");
      const result = spawnSync("/bin/bash", [wrapper, "--headless", "report.html"], {
        cwd: directory,
        encoding: "utf8"
      });

      expect(result.status).toBe(64);
      expect(result.stderr).toContain("file:///workspace/hqbot/report.html");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
