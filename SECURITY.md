# Security

HQBot runs in the customer's Cloudflare account. Never commit an HQBase agent credential, owner
token, mailbox content, or Cloudflare credential.

Use `wrangler secret put` or `pnpm hqbot install` for deployed secrets. Keep `.dev.vars` local.

Each teammate can read public web pages. A teammate can send an HQBase reply only after the owner
connects a mailbox-scoped credential. HQBot encrypts that credential before Durable Object storage.
Use **Handle mail** access and do not give the credential broader workspace access.

Report a security problem privately to the repository maintainers. Do not include credentials,
mail content, or customer data in an issue.
