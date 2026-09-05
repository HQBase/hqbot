import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PiArrowUp, PiArrowUUpLeft, PiX } from "react-icons/pi";
import type { Project, ProjectMessage } from "../../../domain/projects";
import type { BotTeammate } from "../../../domain/types";
import { api, errorMessage } from "../../lib/api";
import { AgentMessage } from "../chat/agent-message";
import { MessageDiscussion } from "../chat/message-discussion";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export function GroupConversation({ project, bots }: { project: Project; bots: BotTeammate[] }) {
  const [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [recipients, setRecipients] = useState(project.botIds.slice(0, 6));
  const [prompt, setPrompt] = useState("");
  const [query, setQuery] = useState("");
  const [thread, setThread] = useState("");
  const filter = new URLSearchParams({ query, thread }).toString();
  const [replyTo, setReplyTo] = useState<ProjectMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasOlder, setHasOlder] = useState(false);
  const request = useRef({ id: crypto.randomUUID(), content: "" });
  const end = useRef<HTMLDivElement>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await api<{ messages: ProjectMessage[] }>(
          `/api/projects/${project.id}/messages?${filter}`,
          { signal }
        );
        if (!signal?.aborted) {
          setMessages((current) =>
            [
              ...new Map([...current, ...result.messages].map((item) => [item.id, item])).values()
            ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
          );
          setHasOlder(result.messages.length === 100);
        }
      } catch (cause) {
        if (!signal?.aborted) setError(errorMessage(cause, "Messages could not load"));
      }
    },
    [project.id, filter]
  );
  useEffect(() => {
    const controller = new AbortController();
    setMessages([]);
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !recipients.length || busy) return;
    setBusy(true);
    setError("");
    const content = JSON.stringify({
      content: prompt.trim(),
      recipientIds: recipients,
      parentId: replyTo?.id ?? (thread || undefined)
    });
    if (request.current.content !== content) request.current = { id: crypto.randomUUID(), content };
    try {
      await api(`/api/projects/${project.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ ...JSON.parse(content), id: request.current.id })
      });
      setPrompt("");
      setReplyTo(null);
      await load();
      end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch (cause) {
      setError(errorMessage(cause, "The message could not be sent"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-5 py-3">
        <Input
          aria-label="Search group messages"
          placeholder="Search this conversation…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-5 py-6"
        role="log"
        aria-label="Project conversation"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {thread && (
            <Button
              variant="outline"
              onClick={() => {
                setThread("");
                setReplyTo(null);
              }}
            >
              Back to all messages
            </Button>
          )}
          {hasOlder && messages[0] && (
            <Button
              variant="ghost"
              onClick={async () => {
                const oldest = messages[0];
                if (!oldest) return;
                try {
                  const result = await api<{ messages: ProjectMessage[] }>(
                    `/api/projects/${project.id}/messages?${filter}&before=${encodeURIComponent(`${oldest.createdAt}:${oldest.id}`)}`
                  );
                  setMessages((current) => [...result.messages, ...current]);
                  setHasOlder(result.messages.length === 100);
                } catch (cause) {
                  setError(errorMessage(cause, "Earlier messages could not load"));
                }
              }}
            >
              Load earlier messages
            </Button>
          )}
          {!messages.length && (
            <div className="py-16 text-center">
              <h2 className="text-lg font-medium">Bring the team into the conversation</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                Choose who should answer and describe the outcome. Teammates can pass work to each
                other and bring their results back here.
              </p>
            </div>
          )}
          {messages
            .filter((message) => message.content.toLowerCase().includes(query.toLowerCase()))
            .map((message) => (
              <div key={message.id} className="flex flex-col gap-2">
                {message.parentId && (
                  <p className="ml-10 flex items-center gap-2 text-xs text-muted-foreground">
                    <PiArrowUUpLeft /> Reply to{" "}
                    {messages.find((item) => item.id === message.parentId)?.content.slice(0, 80) ??
                      "an earlier message"}
                  </p>
                )}
                <AgentMessage
                  name={
                    message.senderBotId
                      ? (bots.find((bot) => bot.id === message.senderBotId)?.name ?? "Teammate")
                      : "You"
                  }
                  speaker={message.senderBotId ? "assistant" : "user"}
                  parts={[{ type: "text", text: message.content }]}
                />
                <div className="ml-10 flex items-center gap-3 text-xs text-muted-foreground">
                  <time>{new Date(message.createdAt).toLocaleString()}</time>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setReplyTo(message);
                      if (message.senderBotId && project.botIds.includes(message.senderBotId))
                        setRecipients([message.senderBotId]);
                    }}
                  >
                    Reply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setThread(message.parentId ?? message.id)}
                  >
                    View thread
                  </Button>
                  <MessageDiscussion
                    source={{ kind: "project", id: project.id, messageId: message.id }}
                    onAsk={setPrompt}
                  />
                </div>
              </div>
            ))}
          <div ref={end} />
        </div>
      </div>
      <form
        className="flex shrink-0 flex-col gap-3 border-t bg-background px-5 py-4"
        onSubmit={(event) => void send(event)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Ask</span>
          {bots
            .filter((bot) => project.botIds.includes(bot.id))
            .map((bot) => (
              <Button
                size="sm"
                key={bot.id}
                type="button"
                variant={recipients.includes(bot.id) ? "secondary" : "ghost"}
                aria-pressed={recipients.includes(bot.id)}
                onClick={() =>
                  setRecipients((current) =>
                    current.includes(bot.id)
                      ? current.filter((id) => id !== bot.id)
                      : current.length < 6
                        ? [...current, bot.id]
                        : current
                  )
                }
              >
                @{bot.name}
              </Button>
            ))}
        </div>
        {replyTo && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-xs">
            <span className="truncate">Replying to: {replyTo.content}</span>
            <Button
              size="icon"
              variant="ghost"
              type="button"
              aria-label="Cancel reply"
              onClick={() => setReplyTo(null)}
            >
              <PiX />
            </Button>
          </div>
        )}
        <div className="flex items-end gap-3">
          <Textarea
            aria-label="Message project teammates"
            className="min-h-20 flex-1 resize-none"
            value={prompt}
            maxLength={12000}
            placeholder="What should we work on?"
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Button
            type="submit"
            disabled={busy || !prompt.trim() || !recipients.length}
            aria-label="Send group message"
            size="icon"
          >
            <PiArrowUp />
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {busy
            ? "Sending…"
            : "Each teammate replies when it is free. Its budget and permissions still apply."}
        </p>
      </form>
    </div>
  );
}
