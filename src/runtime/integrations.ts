import {
  type ConnectorTool,
  type CreateCodemodeRuntimeOptions,
  type McpConnectionLike,
  McpConnector
} from "@cloudflare/codemode";

import { mcpConnectorName } from "./mcp";

export class TeammateMcpConnector extends McpConnector<Env> {
  private readonly connection: McpConnectionLike;

  constructor(
    ctx: CreateCodemodeRuntimeOptions["ctx"],
    env: Env,
    private readonly id: string,
    private readonly label: string,
    connection: McpConnectionLike
  ) {
    super(ctx, env);
    this.connection = {
      client: connection.client,
      fetchTools: connection.fetchTools,
      name: connection.name,
      tools: connection.tools
    };
  }

  name(): string {
    return mcpConnectorName(this.id);
  }

  protected instructions(): string {
    return `Use the ${this.label} connection only when it helps with the owner's request.`;
  }

  protected createConnection(): McpConnectionLike {
    return this.connection;
  }

  protected tool(_name: string, tool: ConnectorTool): ConnectorTool {
    return { ...tool, requiresApproval: true };
  }
}
