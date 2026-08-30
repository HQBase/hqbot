import { deploy } from "./deploy.mjs";

process.stdout.write("Installing HQBot into the current Cloudflare account.\n");
try {
  deploy();
  process.stdout.write("Open HQBot and create the first owner account to finish setup.\n");
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown installation error.";
  process.stderr.write(`HQBot install failed: ${message}\n`);
  process.exitCode = 1;
}
