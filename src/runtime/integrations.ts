import {
  type ConnectorTool,
  type CreateCodemodeRuntimeOptions,
  type ExecutionEndStatus,
  type McpConnectionLike,
  McpConnector
} from "@cloudflare/codemode";
import type { PermissionDecision } from "../domain/permissions";
import { ExternalEffectUncertainError, type TeammateExternalEffects } from "./external-effects";
import { mcpConnectorName } from "./mcp";

export class TeammateMcpConnector extends McpConnector<Env> {
  private readonly connection: McpConnectionLike;

  constructor(
    ctx: CreateCodemodeRuntimeOptions["ctx"],
    env: Env,
    private readonly id: string,
    private readonly label: string,
    connection: McpConnectionLike,
    private readonly effects: TeammateExternalEffects,
    private readonly onUncertain: () => Promise<void>,
    private readonly permission?: (
      connector: string,
      action: string,
      input: unknown
    ) => PermissionDecision
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

  protected tool(name: string, connectorTool: ConnectorTool): ConnectorTool {
    return {
      ...connectorTool,
      requiresApproval: true,
      execute: async (args, context) => {
        if (this.permission?.(this.name(), name, args) === "deny")
          throw new Error("An owner permission rule blocks this action");
        if (!context?.executionId || !Number.isInteger(context.seq)) {
          throw new Error("The connected-service execution ID is missing");
        }
        try {
          return await this.effects.run(
            {
              args,
              seq: context.seq,
              connector: this.name(),
              executionId: context.executionId,
              method: name
            },
            async () => connectorTool.execute(args, context)
          );
        } catch (cause) {
          if (cause instanceof ExternalEffectUncertainError) await this.onUncertain();
          throw cause;
        }
      }
    };
  }

  override async disposeExecution(executionId: string, _status: ExecutionEndStatus): Promise<void> {
    this.effects.deleteSettled(executionId);
  }
}
