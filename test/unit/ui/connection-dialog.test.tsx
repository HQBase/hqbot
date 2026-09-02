// @vitest-environment happy-dom

import type { MCPServersState } from "agents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { ConnectionDialog } from "../../../src/ui/components/dialogs/connection-dialog";
import type { McpConnection } from "../../../src/ui/lib/mcp";
import { interact, renderComponent, setInputValue } from "./render.tsx";

const client = vi.hoisted(() => ({
  onMcpUpdate: undefined as ((state: unknown) => void) | undefined
}));
const agent = vi.hoisted(() => ({
  connectMcp: vi.fn(),
  disconnectMcp: vi.fn(),
  listConnections: vi.fn()
}));

vi.mock("agents/react", () => ({
  useAgent: (options: { onMcpUpdate?: (state: unknown) => void }) => {
    client.onMcpUpdate = options.onMcpUpdate;
    return { stub: agent };
  }
}));

const bot = {
  id: "bot-1",
  name: "Research",
  title: "Researcher",
  description: "Finds evidence.",
  brief: "Research requests",
  pinned: false,
  hidden: false,
  status: "idle",
  lastInteractedAt: null,
  lastMessage: null,
  maxSteps: null,
  modelId: "@cf/zai-org/glm-5.3-flash",
  dailyBudgetUsd: 2,
  createdAt: "2026-08-30T12:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z"
} satisfies BotTeammate;

function connection(overrides: Partial<McpConnection> = {}): McpConnection {
  return {
    authUrl: null,
    error: null,
    id: "github",
    name: "GitHub",
    status: "ready",
    toolCount: 3,
    url: "https://mcp.github.example/mcp",
    ...overrides
  };
}

function input(selector: string): HTMLInputElement {
  const element = document.body.querySelector<HTMLInputElement>(selector);
  if (!element) throw new Error(`Missing test input: ${selector}`);
  return element;
}

beforeEach(() => {
  agent.connectMcp.mockReset().mockResolvedValue(connection());
  agent.disconnectMcp.mockReset().mockResolvedValue(undefined);
  agent.listConnections.mockReset().mockResolvedValue([]);
  client.onMcpUpdate = undefined;
});

afterEach(() => {
  document.body.textContent = "";
});

describe("ConnectionDialog", () => {
  it("shows live status, tool counts, authorization, and removal", async () => {
    agent.listConnections.mockResolvedValue([connection()]);
    const view = await renderComponent(<ConnectionDialog bot={bot} open onOpenChange={vi.fn()} />);

    expect(document.body.textContent).toContain("GitHub");
    expect(document.body.textContent).toContain("Connected");
    expect(document.body.textContent).toContain("3 tools");

    const update = {
      prompts: [],
      resources: [],
      servers: {
        linear: {
          auth_url: "https://linear.example/authorize",
          capabilities: null,
          error: null,
          instructions: null,
          name: "Linear",
          server_url: "https://mcp.linear.example/mcp",
          state: "authenticating"
        }
      },
      tools: [
        { name: "create_issue", serverId: "linear" },
        { name: "list_issues", serverId: "linear" }
      ]
    } as unknown as MCPServersState;
    await interact(() => client.onMcpUpdate?.(update));

    expect(document.body.textContent).toContain("Authorization needed");
    expect(document.body.textContent).toContain("2 tools");
    expect(
      document.body.querySelector<HTMLAnchorElement>('a[href*="linear.example"]')?.target
    ).toBe("_blank");

    await interact(() =>
      document.body.querySelector<HTMLButtonElement>('button[aria-label="Remove Linear"]')?.click()
    );
    expect(agent.disconnectMcp).toHaveBeenCalledWith("linear");
    expect(document.body.textContent).not.toContain("Authorization needed");
    await view.unmount();
  });

  it("adds an HTTPS server and omits an empty bearer token", async () => {
    agent.connectMcp.mockResolvedValue(
      connection({ id: "docs", name: "Docs", toolCount: 0, url: "https://docs.example/mcp" })
    );
    const view = await renderComponent(<ConnectionDialog bot={bot} open onOpenChange={vi.fn()} />);
    await setInputValue(input("#mcp-name"), "Docs");
    await setInputValue(input("#mcp-url"), "https://docs.example/mcp");
    await interact(() =>
      document.body
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );

    expect(agent.connectMcp).toHaveBeenCalledWith({
      name: "Docs",
      url: "https://docs.example/mcp"
    });
    expect(document.body.querySelector('button[aria-label="Remove Docs"]')).not.toBeNull();
    await view.unmount();
  });

  it("rejects a non-HTTPS server before it calls the agent", async () => {
    const view = await renderComponent(<ConnectionDialog bot={bot} open onOpenChange={vi.fn()} />);
    await setInputValue(input("#mcp-name"), "Local");
    await setInputValue(input("#mcp-url"), "http://localhost:8787/mcp");
    await interact(() =>
      document.body
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );

    expect(agent.connectMcp).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enter an HTTPS MCP URL");
    await view.unmount();
  });
});
