# Security

HQBot runs in the customer's Cloudflare account. Never commit an HQBase agent credential, owner
password, session value, mailbox content, or Cloudflare credential.

Choose a private `HQBOT_SETUP_TOKEN` of at least 24 characters for the first owner claim. The deploy
script creates the separate installation encryption key when it is missing. Keep `.dev.vars` local.
Never rotate the deployed encryption key unless you first disconnect every HQBase credential.

The setup code is not a normal login token. HQBot ignores it after the owner exists. Owner login
uses a password, a secure session cookie, and persistent attempt limits.

Each teammate can control its Cloudflare Browser Run session, and the owner can watch or take over
through Live View. Keep sensitive accounts signed out unless you intend the teammate to use them.
HQBot does not add a general approval gate to website actions today. It encrypts the HQBase mailbox
credential before Durable Object storage.

A teammate can prepare an HQBase reply only after the owner connects a mailbox-scoped credential.
The durable action waits for explicit owner approval before it sends. Use **Handle mail** access
and do not give the credential broader workspace access.

Report a security problem privately to the repository maintainers. Do not include credentials,
mail content, or customer data in an issue.
