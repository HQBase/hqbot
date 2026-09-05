import { useEffect, useState } from "react";
import { PiMagnifyingGlass } from "react-icons/pi";
import type { SearchHit } from "../../../domain/messages";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { api, errorMessage } from "../../lib/api";
import { DiscussionDialog } from "../chat/message-discussion";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface Results {
  hits: SearchHit[];
  nextOffset: number | null;
  unavailable: string[];
}
export function SearchPage({
  controller,
  onAsk
}: {
  controller: WorkspaceController;
  onAsk: (botId: string, text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Results>({ hits: [], nextOffset: null, unavailable: [] });
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setBusy(Boolean(query.trim()));
    setError("");
    setResult({ hits: [], nextOffset: null, unavailable: [] });
    const timer = window.setTimeout(() => {
      if (!query.trim()) return;
      void api<Results>(`/api/search?q=${encodeURIComponent(query)}`, { signal: abort.signal })
        .then((data) => {
          if (!abort.signal.aborted) setResult(data);
        })
        .catch((cause) => {
          if (!abort.signal.aborted) setError(errorMessage(cause, "Search could not finish"));
        })
        .finally(() => {
          if (!abort.signal.aborted) setBusy(false);
        });
    }, 300);
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [query]);
  return (
    <section className="mx-auto max-w-4xl space-y-5 p-5 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find messages, files, skills, and memory.
        </p>
      </div>
      <div className="relative">
        <PiMagnifyingGlass className="absolute left-3 top-3 text-muted-foreground" />
        <Input
          aria-label="Search workspace"
          className="pl-9"
          value={query}
          maxLength={200}
          placeholder="Search saved work…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Searching…
        </p>
      )}
      {!busy && query.trim() && !result.hits.length && !error && (
        <p className="text-sm text-muted-foreground">No matching work found.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result.unavailable.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          Some histories were unavailable: {result.unavailable.join(", ")}. Try again.
        </p>
      )}
      <div className="space-y-3">
        {result.hits.map((hit) => (
          <button
            type="button"
            key={`${hit.kind}:${hit.botId ?? hit.projectId}:${hit.id}`}
            className="w-full rounded-xl border bg-card p-4 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setSelected(hit)}
          >
            <p className="mb-1 text-xs text-muted-foreground">
              {hit.kind} · {hit.label}
            </p>
            <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{hit.text}</p>
          </button>
        ))}
      </div>
      {result.nextOffset !== null && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const next = await api<Results>(
                `/api/search?q=${encodeURIComponent(query)}&offset=${result.nextOffset}`
              );
              setResult((current) => ({
                ...next,
                hits: [...current.hits, ...next.hits],
                unavailable: [...current.unavailable, ...next.unavailable]
              }));
            } catch (cause) {
              setError(errorMessage(cause, "More histories could not load"));
            } finally {
              setBusy(false);
            }
          }}
        >
          Search more teammate histories
        </Button>
      )}
      {selected && (selected.kind === "message" || selected.kind === "project") ? (
        <DiscussionDialog
          source={{
            kind: selected.kind === "message" ? "bot" : "project",
            id: selected.botId ?? selected.projectId ?? "",
            messageId: selected.id
          }}
          onClose={() => setSelected(null)}
          onAsk={selected.botId ? (text) => onAsk(selected.botId ?? "", text) : undefined}
        />
      ) : (
        selected && (
          <SavedResult
            hit={selected}
            onClose={() => setSelected(null)}
            onOpen={() => {
              const bot = controller.snapshot?.bots.find((item) => item.id === selected.botId);
              if (bot) controller.selectBot(bot);
              onAsk(
                selected.botId ?? "",
                `Use this saved ${selected.kind}: ${selected.label}\n\n${selected.text}`
              );
            }}
          />
        )
      )}
    </section>
  );
}

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

function SavedResult({
  hit,
  onClose,
  onOpen
}: {
  hit: SearchHit;
  onClose: () => void;
  onOpen: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>{hit.label}</DialogTitle>
        <DialogDescription>Saved {hit.kind}</DialogDescription>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">
          {hit.text}
        </pre>
        {hit.kind === "file" ? (
          <Button asChild>
            <a
              href={`/api/bots/${encodeURIComponent(hit.botId ?? "")}/files/${encodeURIComponent(hit.id)}?download=1`}
            >
              Download file
            </a>
          </Button>
        ) : (
          <Button onClick={onOpen}>Use in conversation</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
