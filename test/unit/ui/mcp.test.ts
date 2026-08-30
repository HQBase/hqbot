import type { MCPServersState } from "agents";
import { describe, expect, it } from "vitest";

import { connectionsFromUpdate, httpsUrl, mcpStatusLabel } from "../../../src/ui/lib/mcp";

describe("MCP connection presentation", () => {
  it("normalizes native realtime state and counts each server's tools", () => {
    const state = {
      prompts: [],
      resources: [],
      servers: {
        github: {
          auth_url: null,
          capabilities: null,
          error: null,
          instructions: null,
          name: "GitHub",
          server_url: "https://mcp.github.example/mcp",
          state: "ready"
        }
      },
      tools: [
        { name: "issues", serverId: "github" },
        { name: "pull_requests", serverId: "github" }
      ]
    } as unknown as MCPServersState;

    expect(connectionsFromUpdate(state)).toEqual([
      expect.objectContaining({ id: "github", status: "ready", toolCount: 2 })
    ]);
    expect(mcpStatusLabel("ready")).toBe("Connected");
  });

  it("accepts only HTTPS URLs without embedded credentials", () => {
    expect(httpsUrl("https://example.com/mcp")).toBe("https://example.com/mcp");
    expect(httpsUrl("http://example.com/mcp")).toBeNull();
    expect(httpsUrl("https://user:secret@example.com/mcp")).toBeNull();
    expect(httpsUrl("not a URL")).toBeNull();
  });
});
