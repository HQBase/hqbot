export interface ConnectorPreset {
  id: string;
  name: string;
  description: string;
  url: string;
  docs: string;
  auth: "Public" | "Sign in" | "Token";
  setup: string;
}
// Official provider setup pages checked 2026-09-05. This is setup help, not an access policy.
export const connectorCatalog: readonly ConnectorPreset[] = [
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    description: "Find official platform documentation.",
    url: "https://docs.mcp.cloudflare.com/mcp",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/",
    auth: "Public",
    setup:
      "No account or token is needed. Connect, then ask your teammate to search the documentation."
  },
  {
    id: "github",
    name: "GitHub",
    description: "Work with repositories, issues, and pull requests.",
    url: "https://api.githubcopilot.com/mcp/",
    docs: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
    auth: "Token",
    setup:
      "Use a fine-grained GitHub token with access only to the needed repositories. OAuth may require a registered client; a token works with the current connection form."
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search and update workspace pages.",
    url: "https://mcp.notion.com/mcp",
    docs: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
    auth: "Sign in",
    setup: "Connect, then choose Authorize and select the Notion workspace and pages to share."
  },
  {
    id: "linear-read",
    name: "Linear · read only",
    description: "Read issues and projects without write access.",
    url: "https://mcp.linear.app/mcp/readonly",
    docs: "https://linear.app/docs/mcp",
    auth: "Sign in",
    setup:
      "This endpoint exposes only read tools. HQBot still applies your action permission rules."
  },
  {
    id: "linear",
    name: "Linear",
    description: "Read and update issues and projects.",
    url: "https://mcp.linear.app/mcp",
    docs: "https://linear.app/docs/mcp",
    auth: "Sign in",
    setup:
      "Connect, then choose Authorize. Use the read-only option when the task needs no changes."
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Investigate application errors.",
    url: "https://mcp.sentry.dev/mcp",
    docs: "https://mcp.sentry.dev/",
    auth: "Sign in",
    setup: "Connect and authorize the Sentry account and organization your teammate needs."
  },
  {
    id: "atlassian",
    name: "Atlassian Rovo",
    description: "Find work in Jira and Confluence.",
    url: "https://mcp.atlassian.com/v2/mcp",
    docs: "https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/",
    auth: "Sign in",
    setup:
      "Connect and authorize your Atlassian account. Your organization may need to permit this client."
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Work with billing and payment data.",
    url: "https://mcp.stripe.com/",
    docs: "https://docs.stripe.com/mcp",
    auth: "Sign in",
    setup:
      "Connect and choose the Stripe account during authorization. Use a sandbox account when testing."
  },
  {
    id: "slack",
    name: "Slack",
    description: "Search messages and work in channels.",
    url: "https://mcp.slack.com/mcp",
    docs: "https://docs.slack.dev/ai/slack-mcp-server/",
    auth: "Token",
    setup:
      "Slack requires a registered internal or published app. Supply its authorized user token with the required scopes. Slack does not support automatic client registration. Inbound Slack events are configured separately in Automations."
  }
];
