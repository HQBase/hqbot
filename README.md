<p align="center">
  <strong>HQBot</strong>
</p>

<h1 align="center">Self-hosted AI teammates on Cloudflare</h1>

<p align="center">
  Create AI teammates in chat, give them whole jobs, and connect the tools they need. The
  teammates, work history, browser, AI, connections, and artifacts stay in your Cloudflare account.
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FHQBase%2Fhqbot">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
  </a>
</p>

HQBot is an independent open-source project. It is not affiliated with xAI, X, or Grok Bot. It
copies no proprietary code or assets.

## What works

- Durable teammates with editable profiles, pin, archive, and duplicate controls.
- Direct chat, file context, durable memory, reusable slash-command skills, and scheduled routines.
- Explicit `@Name` collaboration with separate specialist passes and one final answer.
- A real shared Browser Run computer with screenshot takeover, click, type, key, and URL controls.
- Encrypted browser cookies that teammates can reuse for research after the short live session stops.
- Workers AI planning and evidence-based writing with GLM 5.3 Flash first and DeepSeek V4 Flash as
  the fallback.
- Durable Workflows with bounded retries, owner stop controls, and review-first email replies.
- A per-teammate HQBase connection that checks an inbox and uses only existing HQBase APIs.
- Reply deduplication before the non-idempotent HQBase send.
- R2 files and browser screenshots that the owner can review in the app.
- A responsive HQBase-aligned interface for teammates, conversation, computer, connections, memory,
  skills, routines, and files.

HQBot does not expose a general terminal or let the AI make arbitrary browser write actions. The
owner controls the shared computer. Autonomous browser work is read-only. Purchases, sends, and
other external write actions are outside the current boundary, except for an approved HQBase reply.

## Cloudflare architecture

| Need | Cloudflare service |
| --- | --- |
| Web app and API | Workers and Static Assets |
| Durable teammate identities, connections, and history | Durable Objects with SQLite |
| Long tasks and retries | Workflows |
| Planning and writing | Workers AI |
| Public web research | Browser Run |
| Review screenshots | R2 |
| Inbox routine | Cron Trigger |
| Cost limit | Durable Object daily task count |

HQBase stays the only mail system. A teammate can connect a mailbox-scoped HQBase agent credential.
HQBot validates and encrypts the credential, then uses the existing message, thread, and reply APIs.

## Install

You need:

- A Cloudflare account with Workers Paid, Workers AI, Browser Run, Workflows, and R2.
- A deployed HQBase workspace.
- Node.js 22 or newer and pnpm 11.

Clone this repository, then run:

```sh
pnpm install
pnpm hqbot install
```

The installer creates the R2 bucket, deploys the Worker, and stores its owner and connection
encryption keys as Worker secrets. It prints the owner token once. Keep that token in a password
manager.

The Deploy to Cloudflare button creates the Cloudflare service shell. Run the installer afterward
to set the owner and connection encryption keys.

For later code updates, run `pnpm deploy`. The installer refuses to rotate an existing connection
encryption key.

Inside HQBot, select **New teammate** and describe the job in chat. Use **Connect** in that chat to
add HQBase. Paste the HTTPS URL of your HQBase workspace and a mailbox-scoped agent credential with
**Handle mail** access. The connection belongs to that teammate.

## Develop

Create `.dev.vars` with the values listed in `.dev.vars.example`, then run:

```sh
pnpm install
pnpm cf:typegen
pnpm dev
```

Run the full local gate before a deploy:

```sh
pnpm check
```

## Security boundary

HQBot only researches public HTTP and HTTPS pages. It rejects common private and loopback hosts,
bounds response sizes, treats webpage text as untrusted evidence, and does not expose its API
without an owner token. Autonomous browser actions are read-only. Direct shared-computer actions
come from the owner.

The default daily limit is 50 tasks. Routines cannot run more often than every 15 minutes. The live
computer has a two-minute idle limit and can be stopped at once. Change these controls only when you
understand your Cloudflare plan and expected usage.

Read [SECURITY.md](SECURITY.md) before you expose a deployment to the internet.

## License

HQBot is available under AGPL-3.0-only. See [LICENSE](LICENSE).
