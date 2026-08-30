# HQBot Repository Guide

HQBot is a public, self-hosted Cloudflare agent for AI teammates and connected tools.

Always write in Simplified Technical English (ASD-STE100). Use simple, brief, clear, and humane language.

## Boundaries

- Keep HQBot separate from HQBase product code and public product documentation.
- Keep user data, connection credentials, AI state, browser artifacts, and logs in the user's
  Cloudflare account.
- Use compatible remote MCP servers for agent tools. Discover their tools at run time.
- Keep future inbound triggers separate from MCP tools. Use signed webhook or channel adapters with
  replay protection.
- Never log credentials, prompts, tool results, or connected service content.
- Require owner approval for every generic remote MCP tool. Do not trust a server's read-only label.
  Use idempotency keys or duplicate checks when the connected service supports them.
- Use Cloudflare services for compute, state, AI, browser work, queues, schedules, and object storage.
- Record storage changes as ordered schema migrations and test fresh and update paths.
- Run the complete local gate and one deployed real-world connected-tool flow before completion.

## Quality gate

```sh
pnpm check
pnpm deploy:dry-run
```

Run `pnpm cf:typegen` after each `wrangler.jsonc` change.
