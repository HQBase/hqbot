import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Linux command runner", () => {
  it("drains large output, returns bounded text, and preserves the script exit code", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hqbot-runner-"));
    const script = path.join(directory, "command.sh");
    const result = path.join(directory, "result.json");
    try {
      await writeFile(
        script,
        'node -e \'process.stdout.write("x".repeat(70000)); process.stderr.write("y".repeat(70000)); process.exit(7)\'\n'
      );
      const child = spawn(
        process.execPath,
        [path.join(repository, "scripts/run-agent-command.mjs")],
        {
          env: {
            ...process.env,
            HQBOT_RESULT_FILE: result,
            HQBOT_SCRIPT_FILE: script
          }
        }
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      const [code] = (await once(child, "close")) as [number];

      expect(code, Buffer.concat(stderr).toString()).toBe(7);
      expect(Buffer.concat(stdout).toString()).toMatch(/^x{64000}\n\[output truncated\]\n$/u);
      expect(Buffer.concat(stderr).toString()).toMatch(/^y{64000}\n\[output truncated\]\n$/u);
      expect(JSON.parse(await readFile(result, "utf8"))).toEqual({
        durationMs: expect.any(Number),
        exitCode: 7,
        stderr: Buffer.concat(stderr).toString(),
        stdout: Buffer.concat(stdout).toString()
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
