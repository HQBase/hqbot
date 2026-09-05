# People and access

The owner opens **Settings → People** to invite someone. Select a role and projects, then copy the
private invitation link. It expires after seven days and can be used once. The person creates their
own username and password. HQBot does not send the invitation for you.

| Role | Access |
| --- | --- |
| Owner | Full workspace, credentials, approvals, permission rules, and network policy |
| Administrator | All projects and teammates; invitations and member access |
| Member | Read and request work in assigned projects |
| Viewer | Read assigned projects and teammates |

Only the owner can create or change administrators. Members use a separate, simple workspace view.
They cannot open the owner's agent RPC or realtime connection. Tool approvals and recurring
routines stay with the owner.

**Project access includes the full history and files of each teammate in that project.** Use
separate teammates when two projects need confidential histories. A teammate's computer and
connected-service sessions still belong to that teammate.

Select **Edit access** to change projects, roles, or disable an account. This signs the person out.
Every later read or work action checks their current access. Queued group requests and continued
team turns also check access. A finished download or external action cannot be recalled.

The access log records who changed accounts, invitations, access, or team work. It does not store
conversation content or credentials. It keeps the latest 10,000 entries; the UI shows the latest 100.

## Network policy

Open **Settings → Network**. Standard mode uses the teammate's existing permissions. **Approved
connectors only** stops active work and blocks agent computer, browser, shell, and local command
tools. Enter exact HTTPS MCP server origins, one per line. An empty list blocks all MCP servers.

This controls HQBot's direct tool access. A permitted remote service can have its own network and
data access. The owner should grant narrow action rules for that service. These restrictions do
not block the model service, Cloudflare storage, or an owner's manual control of their computer.
