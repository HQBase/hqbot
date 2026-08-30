import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { stdin, stdout } from "node:process"
import { createInterface } from "node:readline/promises"

const rl = createInterface({ input: stdin, output: stdout })

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

async function ask(label, fallback = "") {
  const suffix = fallback ? ` [${fallback}]` : ""
  const value = (await rl.question(`${label}${suffix}: `)).trim()
  return value || fallback
}

function assertHttpsOrigin(value) {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("HQBase origin must be an HTTPS origin without a path")
  }
  return url.origin
}

function assertMailboxAddress(value) {
  if (!/^[^\s@]+@[^\s@]+$/u.test(value)) throw new Error("Mailbox address is invalid")
  return value.toLowerCase()
}

async function main() {
  stdout.write("HQBot installs into your current Cloudflare account.\n\n")
  const origin = assertHttpsOrigin(await ask("HQBase origin", "https://hqbase.example.com"))
  const mailboxId = await ask("HQBase mailbox ID")
  const mailboxAddress = assertMailboxAddress(await ask("HQBase mailbox address"))
  const allowedSenders = await ask("Allowed sender addresses, separated by commas", mailboxAddress)
  if (!mailboxId) throw new Error("HQBase mailbox ID is required")

  run("pnpm", ["build"])
  if (!check("pnpm", ["exec", "wrangler", "r2", "bucket", "info", "hqbot-artifacts"])) {
    run("pnpm", ["exec", "wrangler", "r2", "bucket", "create", "hqbot-artifacts"])
  }
  run("pnpm", ["exec", "wrangler", "deploy"])

  const ownerToken = randomBytes(32).toString("base64url")
  const values = {
    HQBOT_OWNER_TOKEN: ownerToken,
    HQBASE_ORIGIN: origin,
    HQBASE_MAILBOX_ID: mailboxId,
    HQBASE_MAILBOX_ADDRESS: mailboxAddress,
    HQBOT_ALLOWED_SENDERS: allowedSenders,
  }
  for (const [name, value] of Object.entries(values)) {
    run("pnpm", ["exec", "wrangler", "secret", "put", name], { input: `${value}\n` })
  }

  stdout.write("\nWrangler will now ask for the mailbox-scoped HQBase agent credential.\n")
  run("pnpm", ["exec", "wrangler", "secret", "put", "HQBASE_AGENT_TOKEN"])
  stdout.write("\nHQBot is ready. Save this owner token now; it will not be shown again:\n\n")
  stdout.write(`${ownerToken}\n`)
}

try {
  await main()
} finally {
  rl.close()
}
