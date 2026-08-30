# HQBot Repository Guide

HQBot is a public, self-hosted Cloudflare agent that connects to HQBase through the published Mail API.

Always write in Simplified Technical English (ASD-STE100). Use simple, brief, clear, and humane language.

## Boundaries

- Keep HQBot separate from HQBase product code and public product documentation.
- Keep user mail, agent credentials, AI state, browser artifacts, and logs in the user's Cloudflare account.
- Use HQBase Mail API v2. Do not implement mail transport or mailbox storage.
- Never log credentials or mail content.
- Put every non-idempotent external action behind an exact duplicate check.
- Use Cloudflare services for compute, state, AI, browser work, workflows, and object storage.
- Record storage changes as ordered schema migrations and test fresh and update paths.
- Run the complete local gate and one deployed real-world workflow before completion.

## Quality gate

```sh
pnpm check
pnpm deploy:dry-run
```

Run `pnpm cf:typegen` after each `wrangler.jsonc` change.

