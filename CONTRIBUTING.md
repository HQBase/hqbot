# Contributing

Keep changes small and product-focused. HQBot is a separate product and repository. Do not change
HQBase Mail documentation, marketing, or product copy for an HQBot change.

Before a pull request, run:

```sh
pnpm check
```

Record each Durable Object schema change as a new migration. Add fresh-install and update tests.
Use only Cloudflare services for runtime compute, AI, browsers, workflows, queues, and storage.
