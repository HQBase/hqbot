import { useCallback, useEffect, useRef, useState } from "react";
import { PiChatCircle } from "react-icons/pi";
import type { Discussion, MessageSource } from "../../../domain/messages";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { MarkdownText } from "./markdown-text";

export function MessageDiscussion({
  source,
  onAsk
}: {
  source: MessageSource;
  onAsk?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <PiChatCircle /> Discuss
      </Button>
      {open && <DiscussionDialog source={source} onClose={() => setOpen(false)} onAsk={onAsk} />}
    </>
  );
}

export function DiscussionDialog({
  source,
  onClose,
  onAsk
}: {
  source: MessageSource;
  onClose: () => void;
  onAsk?: (text: string) => void;
}) {
  const [data, setData] = useState<(Discussion & { content: string }) | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef({ id: crypto.randomUUID(), content: "" });
  const query = new URLSearchParams(source).toString();
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await api<Discussion & { content: string }>(`/api/discussions?${query}`, {
          signal
        });
        if (!signal?.aborted) setData(result);
      } catch (cause) {
        if (!signal?.aborted) setError(errorMessage(cause, "Discussion could not load"));
      }
    },
    [query]
  );
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(abort.signal);
    }, 5000);
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, [load]);
  async function save(value: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await api("/api/discussions", {
        method: "POST",
        body: JSON.stringify({ ...source, ...value })
      });
      await load();
      if (value.action === "note") setNote("");
    } catch (cause) {
      setError(errorMessage(cause, "The change could not be saved"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>Discussion</DialogTitle>
        <DialogDescription>
          Keep notes and reactions with this message. Ask the teammate when you want more work.
        </DialogDescription>
        {data ? (
          <>
            <div className="max-h-56 overflow-y-auto rounded-xl border bg-muted/30 p-4 text-sm">
              <MarkdownText text={data.content} />
            </div>
            <div className="flex flex-wrap gap-1">
              {["👍", "❤️", "✅", "👀", "🎉"].map((emoji) => {
                const reaction = data.reactions.find((item) => item.emoji === emoji);
                return (
                  <Button
                    key={emoji}
                    size="sm"
                    variant={reaction?.mine ? "secondary" : "ghost"}
                    aria-label={`React ${emoji}`}
                    aria-pressed={reaction?.mine ?? false}
                    disabled={busy}
                    onClick={() => void save({ action: "react", emoji, active: !reaction?.mine })}
                  >
                    {emoji} {reaction?.count || ""}
                  </Button>
                );
              })}
            </div>
            <div className="space-y-3" role="log" aria-label="Discussion notes">
              {data.notes.length === 0 && (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
              {data.notes.map((item) => (
                <article key={item.id} className="rounded-lg border p-3">
                  <p className="mb-1 text-xs text-muted-foreground">
                    {item.userId === "owner" ? "Owner" : "Team member"} ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm">{item.content}</p>
                </article>
              ))}
            </div>
            <Textarea
              aria-label="Discussion note"
              placeholder="Add a note…"
              value={note}
              maxLength={4000}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {onAsk && (
                <Button
                  variant="outline"
                  onClick={() => {
                    onAsk(
                      `About this message:\n\n${data.content}\n\n${note.trim() || "Please continue from this result."}`
                    );
                    onClose();
                  }}
                >
                  Ask teammate
                </Button>
              )}
              <Button
                disabled={busy || !note.trim()}
                onClick={() => {
                  if (request.current.content !== note)
                    request.current = { id: crypto.randomUUID(), content: note };
                  void save({ action: "note", noteId: request.current.id, content: note });
                }}
              >
                {busy ? "Saving…" : "Save note"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Loading message…</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
