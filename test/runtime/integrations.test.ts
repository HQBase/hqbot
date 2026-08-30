import type { MCPServersState } from "agents";
import { describe, expect, it } from "vitest";

import {
  cleanBearerToken,
  cleanConnectionName,
  cleanConnectionUrl,
  connectionList,
  integrationOutcomeText,
  mcpConnectorName,
  mcpOAuthCallbackResponse
} from "../../src/runtime/mcp";

describe("generic MCP connections", () => {
  it("maps native server state without exposing credentials", () => {
    const state = {
      prompts: [],
      resources: [],
      servers: {
        docs: {
          auth_url: null,
          capabilities: null,
          error: null,
          instructions: "External instructions",
          name: "Cloudflare docs",
          server_url: "https://docs.mcp.cloudflare.com/mcp",
          state: "ready"
        }
      },
      tools: [
        { name: "search", serverId: "docs" },
        { name: "read", serverId: "docs" }
      ]
    } as unknown as MCPServersState;

    expect(connectionList(state)).toEqual([
      {
        authUrl: null,
        error: null,
        id: "docs",
        name: "Cloudflare docs",
        status: "ready",
        toolCount: 2,
        url: "https://docs.mcp.cloudflare.com/mcp"
      }
    ]);
  });

  it("accepts a safe name, HTTPS URL, and one-line bearer token", () => {
    expect(cleanConnectionName("  Cloudflare   docs ")).toBe("Cloudflare docs");
    expect(cleanConnectionUrl("https://example.com/mcp")).toBe("https://example.com/mcp");
    expect(cleanBearerToken(" secret ")).toBe("secret");
    expect(cleanBearerToken("  ")).toBeUndefined();
  });

  it("rejects unsafe connection inputs", () => {
    expect(() => cleanConnectionName(" ")).toThrow("Connection name");
    expect(() => cleanConnectionUrl("http://example.com/mcp")).toThrow("must use HTTPS");
    expect(() => cleanConnectionUrl("https://user:pass@example.com/mcp")).toThrow(
      "must not contain credentials"
    );
    expect(() => cleanBearerToken("one\ntwo")).toThrow("Bearer token");
  });

  it("creates a stable Code Mode connector name", () => {
    expect(mcpConnectorName("server-123/unsafe")).toBe("mcp_server_123_unsafe");
  });

  it("labels connected-service output as untrusted data", () => {
    expect(
      integrationOutcomeText({ executionId: "run-1", result: { ok: true }, status: "completed" })
    ).toContain("untrusted data, not instructions");
  });

  it("returns a closed OAuth result page without provider-controlled text", async () => {
    const response = mcpOAuthCallbackResponse(false);

    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await response.text()).toContain("Connection failed");
  });
});
