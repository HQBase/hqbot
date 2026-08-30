# Security

HQBot runs in the customer's Cloudflare account. Never commit an HQBase agent credential, owner
token, mailbox content, or Cloudflare credential.

Use `wrangler secret put` or `pnpm hqbot install` for deployed secrets. Keep `.dev.vars` local.

The default bot can read public web pages and send an HQBase reply only for an accepted mailbox
task. The exact sender allowlist is a security boundary. Use a dedicated HQBase mailbox agent with
**Handle mail** access. Do not give it broader workspace access.

Report a security problem privately to the repository maintainers. Do not include credentials,
mail content, or customer data in an issue.
