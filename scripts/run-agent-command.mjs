#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { rename, writeFile } from "node:fs/promises";

const limit = 64_000;
const scriptFile = process.env.HQBOT_SCRIPT_FILE;
const resultFile = process.env.HQBOT_RESULT_FILE;
if (!scriptFile || !resultFile) {
  throw new Error("HQBot command paths are required");
}

const child = spawn(
  "bash",
  [
    "-c",
    'trap \'status=$?; trap - EXIT; wait; exit "$status"\' EXIT; source "$1"',
    "hqbot-command",
    scriptFile
  ],
  {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  }
);

async function forward(input, output) {
  const captured = [];
  let written = 0;
  let truncated = false;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const selected = bytes.subarray(0, Math.max(0, limit - written));
    if (selected.length > 0) {
      if (!output.write(selected)) await once(output, "drain");
      captured.push(selected);
      written += selected.length;
    }
    if (selected.length < bytes.length) truncated = true;
  }
  if (truncated) {
    const notice = Buffer.from("\n[output truncated]\n");
    if (!output.write(notice)) await once(output, "drain");
    captured.push(notice);
  }
  return Buffer.concat(captured).toString();
}

const startedAt = Date.now();
const completion = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code) => resolve(code));
});
const [stdout, stderr, code] = await Promise.all([
  forward(child.stdout, process.stdout),
  forward(child.stderr, process.stderr),
  completion
]);
const exitCode = code ?? 1;
const temporaryResult = `${resultFile}.tmp`;
await writeFile(
  temporaryResult,
  JSON.stringify({ durationMs: Date.now() - startedAt, exitCode, stderr, stdout })
);
await rename(temporaryResult, resultFile);
process.exitCode = exitCode;
