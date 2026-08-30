<p align="center">
  <strong>HQBot</strong>
</p>

<h1 align="center">A self-hosted AI teammate on Cloudflare</h1>

<p align="center">
  HQBot accepts whole jobs, researches the public web in a real cloud browser, and replies through
  its HQBase mailbox. The bot, work history, browser, AI, and artifacts stay in your Cloudflare
  account.
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FHQBase%2Fhqbot">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
  </a>
</p>

HQBot is an independent open-source project. It is not affiliated with xAI, X, or Grok Bot. It
copies no proprietary code or assets.

## What works

- One durable bot with a natural task conversation and visible work history.
- A real Browser Run session that reads up to three public sources per task.
- Workers AI planning and evidence-based writing.
- Durable Workflows with bounded retries for research and replies.
- A scheduled HQBase inbox routine with an exact sender allowlist.
- Reply deduplication before the non-idempotent HQBase send.
- R2 browser screenshots that the owner can review in the app.
- A responsive three-panel interface for the bot, conversation, computer, and routine.

This first release optimizes for a convincing end-to-end teammate. It does not include multi-bot
groups, arbitrary app control, payments, or a skill marketplace.

## Cloudflare architecture

| Need | Cloudflare service |
| --- | --- |
| Web app and API | Workers and Static Assets |
| Durable bot identity and history | Durable Objects with SQLite |
| Long tasks and retries | Workflows |
| Planning and writing | Workers AI |
| Public web research | Browser Run |
| Review screenshots | R2 |
| Inbox routine | Cron Trigger |

HQBase stays the only mail system. HQBot uses the existing message, thread, and reply APIs with a
mailbox-scoped agent credential.

## Install

You need:

- A Cloudflare account with Workers Paid, Workers AI, Browser Run, Workflows, and R2.
- A deployed HQBase workspace.
- A dedicated HQBase mailbox agent with **Handle mail** access.
- Node.js 22 or newer and pnpm 11.

Clone this repository, then run:

```sh
pnpm install
pnpm hqbot install
```

The installer creates the R2 bucket, deploys the Worker, asks Wrangler to store the HQBase agent
credential, and stores the remaining configuration as encrypted Worker secrets. It prints the
owner token once. Keep that token in a password manager.

The Deploy to Cloudflare button creates the Cloudflare service shell. Run the installer afterward
to connect the HQBase mailbox and set the owner token.

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
without an owner token. The first release has no browser write actions.

Read [SECURITY.md](SECURITY.md) before you expose a deployment to the internet.

## License

HQBot is available under AGPL-3.0-only. See [LICENSE](LICENSE).
