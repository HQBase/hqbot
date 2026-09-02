# Security

HQBot runs in the customer's Cloudflare account. Never commit an MCP credential, owner password,
session value, customer content, or Cloudflare credential.

Choose a private `HQBOT_SETUP_TOKEN` of at least 24 characters for the first owner claim. Keep
`.dev.vars` local.

The setup code is not a normal login token. HQBot ignores it after the owner exists. Owner login
uses a password, a secure session cookie, and persistent attempt limits.

Each teammate has one private Sandbox Linux computer for Bash, visible Chrome, and other GUI
applications. The owner can watch the same desktop and can take control. New model browser and
Bash actions pause during owner control. Existing processes can continue. Keep sensitive accounts
signed out unless you intend the teammate to use them. HQBot does not add a general approval gate
to website actions today.

Remote MCP servers and their tool descriptions are untrusted. HQBot stores each connection in the
teammate Durable Object and never returns a saved bearer token to the app. Every generic remote MCP
tool pauses for explicit owner approval. Give each connection the smallest access that the teammate
needs.

Report a security problem privately to the repository maintainers. Do not include credentials or
customer data in an issue.
