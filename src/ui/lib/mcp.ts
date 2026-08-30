import type { MCPServersState } from "agents";

export interface McpConnection {
  authUrl: string | null;
  error: string | null;
  id: string;
  name: string;
  status: "authenticating" | "connected" | "connecting" | "discovering" | "failed" | "ready";
  toolCount: number;
  url: string;
}

export function connectionsFromUpdate(state: MCPServersState): McpConnection[] {
  return Object.entries(state.servers).map(([id, server]) => ({
    authUrl: server.auth_url,
    error: server.error,
    id,
    name: server.name,
    status: server.state,
    toolCount: state.tools.filter((tool) => tool.serverId === id).length,
    url: server.server_url
  }));
}

export function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function mcpStatusLabel(status: McpConnection["status"]): string {
  if (status === "ready") return "Connected";
  if (status === "authenticating") return "Authorization needed";
  if (status === "failed") return "Failed";
  return "Connecting";
}
