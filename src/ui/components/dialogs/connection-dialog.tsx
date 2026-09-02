import type { MCPServersState } from "agents";
import { useAgent } from "agents/react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { PiArrowSquareOut, PiLink, PiPlugsConnected, PiShieldCheck, PiTrash } from "react-icons/pi";

import type { BotTeammate } from "../../../domain/types";
import { errorMessage } from "../../lib/api";
import { connectionsFromUpdate, httpsUrl, type McpConnection, mcpStatusLabel } from "../../lib/mcp";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

interface TeammateMcpAgent {
  readonly state: unknown;
  connectMcp(input: { name: string; token?: string; url: string }): Promise<McpConnection>;
  disconnectMcp(id: string): Promise<void>;
  listConnections(): Promise<McpConnection[]>;
}

export function ConnectionDialog({
  bot,
  open,
  onOpenChange
}: {
  bot: BotTeammate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [url, setUrl] = useState("https://");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const onMcpUpdate = useCallback((state: MCPServersState) => {
    setConnections(connectionsFromUpdate(state));
    setLoading(false);
  }, []);
  const agent = useAgent<TeammateMcpAgent, unknown>({
    agent: "HQBOT_TEAMMATE",
    name: bot.id,
    onMcpUpdate
  });
  const refresh = useCallback(async () => {
    try {
      setConnections(await agent.stub.listConnections());
      setError("");
    } catch (cause) {
      setError(errorMessage(cause, "Connections could not load"));
    } finally {
      setLoading(false);
    }
  }, [agent.stub]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const endpoint = httpsUrl(url);
    if (!endpoint) {
      setError("Enter an HTTPS MCP URL");
      return;
    }
    setPending(true);
    setError("");
    try {
      const bearer = token.trim();
      const connection = await agent.stub.connectMcp({
        name: displayName.trim(),
        url: endpoint,
        ...(bearer ? { token: bearer } : {})
      });
      setConnections((current) => [
        ...current.filter((item) => item.id !== connection.id),
        connection
      ]);
      setDisplayName("");
      setToken("");
      setUrl("https://");
    } catch (cause) {
      setError(errorMessage(cause, "MCP server could not connect"));
    } finally {
      setPending(false);
    }
  }

  async function remove(connection: McpConnection): Promise<void> {
    setRemovingId(connection.id);
    setError("");
    try {
      await agent.stub.disconnectMcp(connection.id);
      setConnections((current) => current.filter((item) => item.id !== connection.id));
    } catch (cause) {
      setError(errorMessage(cause, "MCP connection could not be removed"));
    } finally {
      setRemovingId(null);
    }
  }

  const archived = bot.hidden;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)]">
        <DialogHeader>
          <DialogTitle>Connections</DialogTitle>
          <DialogDescription>
            Give {bot.name} tools from remote MCP servers. Status updates appear in real time.
          </DialogDescription>
        </DialogHeader>

        <section aria-label={`Connections for ${bot.name}`} className="grid gap-2">
          <div className="flex items-center justify-between gap-3 text-xs font-medium">
            <span>Connected tools</span>
            <Badge variant="outline">{connections.length}</Badge>
          </div>
          <div className="max-h-52 overflow-y-auto rounded-lg border bg-muted/20 p-1">
            {loading ? (
              <p className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                <Spinner /> Loading connections…
              </p>
            ) : connections.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No MCP servers connected yet.
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {connections.map((connection) => (
                  <ConnectionRow
                    connection={connection}
                    key={connection.id}
                    removing={removingId === connection.id}
                    onRemove={() => void remove(connection)}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <form
          className="flex flex-col gap-4 border-t pt-4"
          onSubmit={(event) => void submit(event)}
        >
          <h3 className="text-xs font-medium">Add an MCP server</h3>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mcp-name">Display name</FieldLabel>
              <Input
                id="mcp-name"
                maxLength={80}
                placeholder="GitHub"
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="mcp-url">HTTPS MCP URL</FieldLabel>
              <Input
                aria-invalid={error ? true : undefined}
                id="mcp-url"
                maxLength={2_000}
                pattern="https://.*"
                required
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mcp-token">Bearer token (optional)</FieldLabel>
              <Input
                autoComplete="off"
                id="mcp-token"
                maxLength={4_000}
                placeholder="Use only when the server requires one"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <FieldDescription>Leave blank for OAuth or public servers.</FieldDescription>
            </Field>
          </FieldGroup>
          {error ? <FieldError>{error}</FieldError> : null}
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <PiShieldCheck /> Saved credentials are never shown. Every tool call needs your
            approval.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              disabled={archived || pending || !displayName.trim() || !url.trim()}
              title={archived ? "Restore this teammate before you add a connection" : undefined}
              type="submit"
            >
              {pending ? <Spinner data-icon="inline-start" /> : <PiLink data-icon="inline-start" />}
              Add connection
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionRow({
  connection,
  removing,
  onRemove
}: {
  connection: McpConnection;
  removing: boolean;
  onRemove: () => void;
}) {
  const authUrl = httpsUrl(connection.authUrl ?? "");
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2">
      <PiPlugsConnected className="text-tertiary" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <strong className="truncate text-xs">{connection.name}</strong>
          <Badge variant={connection.status === "failed" ? "destructive" : "outline"}>
            {mcpStatusLabel(connection.status)}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {connection.toolCount} {connection.toolCount === 1 ? "tool" : "tools"}
          </span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground" title={connection.url}>
          {connection.error ?? connection.url}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {authUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={authUrl} rel="noreferrer" target="_blank">
              Authorize <PiArrowSquareOut data-icon="inline-end" />
            </a>
          </Button>
        ) : null}
        <Button
          aria-label={`Remove ${connection.name}`}
          disabled={removing}
          size="icon"
          title={`Remove ${connection.name}`}
          type="button"
          variant="ghost"
          onClick={onRemove}
        >
          {removing ? <Spinner /> : <PiTrash />}
        </Button>
      </div>
    </li>
  );
}
