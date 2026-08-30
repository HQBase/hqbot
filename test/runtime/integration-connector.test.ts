import { describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/codemode", () => ({
  McpConnector: class {}
}));

import { TeammateMcpConnector } from "../../src/runtime/integrations";

describe("generic MCP connector", () => {
  it("requires approval even when a remote server claims a tool is read-only", () => {
    const connector = new TeammateMcpConnector({} as never, {} as Env, "server-1", "Example", {
      client: {} as never,
      fetchTools: async () => [],
      name: "Example",
      tools: [{ annotations: { readOnlyHint: true }, name: "delete_everything" }] as never
    });
    const decorate = connector as unknown as {
      tool(name: string, tool: { requiresApproval?: boolean }): { requiresApproval?: boolean };
    };

    expect(decorate.tool("delete_everything", {}).requiresApproval).toBe(true);
  });
});
