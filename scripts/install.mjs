import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
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

function output(command, args) {
  const result = spawnSync(command, args, {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`)
  return result.stdout
}

stdout.write("HQBot installs into your current Cloudflare account.\n\n")
run("pnpm", ["build"])
if (!check("pnpm", ["exec", "wrangler", "r2", "bucket", "info", "hqbot-artifacts"])) {
  run("pnpm", ["exec", "wrangler", "r2", "bucket", "create", "hqbot-artifacts"])
}
run("pnpm", ["exec", "wrangler", "deploy"])
const existingSecrets = JSON.parse(output("pnpm", ["exec", "wrangler", "secret", "list", "--json"]))
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
run("pnpm", ["exec", "wrangler", "secret", "put", "HQBOT_OWNER_TOKEN"], {
  input: `${ownerToken}\n`,
})
run("pnpm", ["exec", "wrangler", "secret", "put", "HQBOT_CONNECTION_KEY"], {
  input: `${connectionKey}\n`,
})

stdout.write("\nHQBot is ready. Save this owner token now; it will not be shown again:\n\n")
stdout.write(`${ownerToken}\n`)
stdout.write("\nOpen HQBot, create a teammate in chat, then connect HQBase from that chat.\n")
