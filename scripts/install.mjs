import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stdout } from "node:process"

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    stdio: options.input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    input: options.input,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`)
}

function check(command, args) {
  return (
    spawnSync(command, args, {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      stdio: "ignore",
    }).status === 0
  )
}

function optionalOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.error) throw result.error
  return result.status === 0 ? result.stdout : null
}

stdout.write("HQBot installs into your current Cloudflare account.\n\n")
run("pnpm", ["build"])
if (!check("pnpm", ["exec", "wrangler", "r2", "bucket", "info", "hqbot-artifacts"])) {
  run("pnpm", ["exec", "wrangler", "r2", "bucket", "create", "hqbot-artifacts"])
}
const secretOutput = optionalOutput("pnpm", ["exec", "wrangler", "secret", "list", "--json"])
const existingSecrets = secretOutput ? JSON.parse(secretOutput) : []
if (
  Array.isArray(existingSecrets) &&
  existingSecrets.some(
    (secret) => secret?.name === "HQBOT_OWNER_TOKEN" || secret?.name === "HQBOT_CONNECTION_KEY",
  )
) {
  throw new Error(
    "HQBot is already configured. Use pnpm deploy to update it without rotating keys.",
  )
}
const ownerToken = randomBytes(32).toString("base64url")
const connectionKey = randomBytes(32).toString("base64url")
const secretDirectory = mkdtempSync(join(tmpdir(), "hqbot-install-"))
const secretPath = join(secretDirectory, "secrets.json")
try {
  writeFileSync(
    secretPath,
    JSON.stringify({ HQBOT_OWNER_TOKEN: ownerToken, HQBOT_CONNECTION_KEY: connectionKey }),
    { mode: 0o600 },
  )
  run("pnpm", ["exec", "wrangler", "deploy", "--secrets-file", secretPath])
} finally {
  rmSync(secretDirectory, { recursive: true, force: true })
}

stdout.write("\nHQBot is ready. Save this owner token now; it will not be shown again:\n\n")
stdout.write(`${ownerToken}\n`)
stdout.write("\nOpen HQBot, create a teammate in chat, then connect HQBase from that chat.\n")
