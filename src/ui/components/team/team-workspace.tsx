import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../../../domain/projects";
import type { Principal } from "../../../domain/team";
import type { BotFile, BotTeammate } from "../../../domain/types";
import { api, errorMessage } from "../../lib/api";
import { AgentMessage } from "../chat/agent-message";
import { FilePreview } from "../chat/file-preview";
import { MessageDiscussion } from "../chat/message-discussion";
import { GroupConversation } from "../projects/group-conversation";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { TeamAdministration } from "./team-administration";

interface TeamView {
  user: Principal;
  bots: BotTeammate[];
  projects: Project[];
}
interface Conversation {
  messages: { items: { id: string; role: string; text: string }[]; truncated: boolean };
  files: BotFile[];
}
export function TeamWorkspace({ onSignedOut }: { onSignedOut: () => void }) {
  const [view, setView] = useState<TeamView | null>(null);
  const [selected, setSelected] = useState("");
  const [project, setProject] = useState("");
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const data = await api<TeamView>("/api/team/workspace");
      setView(data);
      setSelected((current) =>
        data.bots.some((bot) => bot.id === current) ? current : (data.bots[0]?.id ?? "")
      );
      setError("");
    } catch (cause) {
      setView(null);
      setError(errorMessage(cause, "Workspace access changed. Sign in again."));
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  const bot = view?.bots.find((item) => item.id === selected);
  const group = view?.projects.find((item) => item.id === project);
  return (
    <main className="flex h-[100dvh] flex-col bg-reader text-foreground">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-rail px-4 py-3">
        <span className="font-semibold">HQBot</span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{view?.user.username}</span>
          {view?.user.role === "admin" && (
            <Button variant="ghost" onClick={() => setAdmin((current) => !current)}>
              {admin ? "Conversations" : "People"}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST" });
              onSignedOut();
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      {error && (
        <p className="p-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {view && admin ? (
        <div className="mx-auto w-full max-w-4xl overflow-y-auto p-5">
          <TeamAdministration user={view.user} />
        </div>
      ) : (
        view && (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <nav
              aria-label="Shared conversations"
              className="flex shrink-0 gap-1 overflow-x-auto border-b bg-list p-3 md:w-64 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r"
            >
              {view.bots.map((item) => (
                <Button
                  className="shrink-0 justify-start"
                  key={item.id}
                  variant={selected === item.id && !project ? "secondary" : "ghost"}
                  onClick={() => {
                    setSelected(item.id);
                    setProject("");
                  }}
                >
                  {item.name}
                </Button>
              ))}
              {view.projects.map((item) => (
                <Button
                  className="shrink-0 justify-start"
                  key={item.id}
                  variant={project === item.id ? "secondary" : "ghost"}
                  onClick={() => setProject(item.id)}
                >
                  # {item.name}
                </Button>
              ))}
            </nav>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              {group ? (
                <GroupConversation
                  key={group.id}
                  project={group}
                  bots={view.bots}
                  readOnly={view.user.role === "viewer"}
                />
              ) : bot ? (
                <TeamConversation key={bot.id} bot={bot} readOnly={view.user.role === "viewer"} />
              ) : (
                <p className="p-8 text-sm text-muted-foreground">
                  No projects are shared with you yet. Ask an administrator for access.
                </p>
              )}
            </section>
          </div>
        )
      )}
    </main>
  );
}
function TeamConversation({ bot, readOnly }: { bot: BotTeammate; readOnly: boolean }) {
  const [data, setData] = useState<Conversation | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef({ id: crypto.randomUUID(), prompt: "" });
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await api<Conversation>(`/api/team/bots/${bot.id}`, { signal });
        if (!signal?.aborted) setData(next);
      } catch (cause) {
        if (!signal?.aborted) {
          setData(null);
          setError(errorMessage(cause, "Conversation could not load"));
        }
      }
    },
    [bot.id]
  );
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(abort.signal);
    }, 4000);
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, [load]);
  async function send() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    if (request.current.prompt !== prompt) request.current = { id: crypto.randomUUID(), prompt };
    try {
      await api(`/api/team/bots/${bot.id}/messages`, {
        method: "POST",
        body: JSON.stringify(request.current)
      });
      setPrompt("");
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "The message could not be sent"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="flex items-center justify-between border-b px-5 py-3">
        <div>
          <h1 className="font-semibold">{bot.name}</h1>
          <p className="text-xs text-muted-foreground">{bot.status.replaceAll("_", " ")}</p>
        </div>
        {!readOnly && (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await api(`/api/team/bots/${bot.id}/stop`, { method: "POST" });
                await load();
              } catch (cause) {
                setError(errorMessage(cause, "The teammate could not stop"));
              }
            }}
          >
            Stop
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="mx-auto max-w-3xl space-y-6 px-5 py-7"
          role="log"
          aria-label={`Conversation with ${bot.name}`}
        >
          {data?.messages.truncated && (
            <p className="text-xs text-muted-foreground">Showing recent messages.</p>
          )}
          {data?.messages.items.map((message) => (
            <div key={message.id} className="space-y-1">
              <AgentMessage
                name={message.role === "user" ? "Workspace member" : bot.name}
                speaker={message.role === "assistant" ? "assistant" : "user"}
                parts={[{ type: "text", text: message.text }]}
              />
              {!readOnly && (
                <MessageDiscussion
                  source={{ kind: "bot", id: bot.id, messageId: message.id }}
                  onAsk={setPrompt}
                />
              )}
            </div>
          ))}
          {Boolean(data?.files.length) && (
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-medium">Shared files</summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {data?.files.map((file) => (
                  <FilePreview file={file} key={file.id} />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
      {error && (
        <p className="px-5 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {!readOnly && (
        <form
          className="flex shrink-0 items-end gap-3 border-t p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            aria-label="Message teammate"
            className="min-h-20 resize-none"
            value={prompt}
            maxLength={12000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What should we work on?"
          />
          <Button disabled={busy || !prompt.trim()} type="submit">
            {busy ? "Sending…" : "Send"}
          </Button>
        </form>
      )}
    </>
  );
}
