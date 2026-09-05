import { useCallback, useEffect, useState } from "react";
import { PiBrain, PiPlus, PiSparkle } from "react-icons/pi";
import type { KnowledgeItem } from "../../../domain/knowledge";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { api, errorMessage } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { DemonstrationList } from "./demonstration-list";
import { KnowledgeEditor } from "./knowledge-editor";
import { RecordDemonstration } from "./record-demonstration";

export function LibraryPage({
  controller,
  onTemplates
}: {
  controller: WorkspaceController;
  onTemplates?: () => void;
}) {
  const [botId, setBotId] = useState(
    controller.selectedBot?.id ?? controller.snapshot?.bots[0]?.id ?? ""
  );
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordingRefresh, setRecordingRefresh] = useState(0);
  const [editor, setEditor] = useState<{ kind: "memory" | "skill"; item?: KnowledgeItem } | null>(
    null
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!botId) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await api<{ items: KnowledgeItem[] }>(`/api/bots/${botId}/knowledge`, {
          signal
        });
        if (!signal?.aborted) {
          setItems(result.items);
          setError("");
        }
      } catch (cause) {
        if (!signal?.aborted) setError(errorMessage(cause, "The library could not load"));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [botId]
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const visible = items.filter(
    (item) =>
      (filter === "all" || item.kind === filter) &&
      (item.kind === "memory"
        ? item.content
        : `${item.name} ${item.description} ${item.instructions}`
      )
        .toLowerCase()
        .includes(query.toLowerCase())
  );
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-5 py-8 sm:px-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Useful memories. Methods that get better with practice.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onTemplates && (
            <Button variant="outline" onClick={onTemplates}>
              Templates
            </Button>
          )}
          <Button disabled={!botId} variant="outline" onClick={() => setRecording(true)}>
            Record a skill
          </Button>
          <Button disabled={!botId} variant="outline" onClick={() => setEditor({ kind: "memory" })}>
            <PiPlus /> Memory
          </Button>
          <Button disabled={!botId} onClick={() => setEditor({ kind: "skill" })}>
            <PiPlus /> Skill
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap gap-3">
        <select
          aria-label="Library teammate"
          className="h-10 max-w-full rounded-md border bg-background px-3 text-sm"
          value={botId}
          onChange={(event) => {
            setBotId(event.target.value);
            setItems([]);
            setEditor(null);
          }}
        >
          {!botId && <option value="">Choose a teammate</option>}
          {controller.snapshot?.bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
        <Input
          className="min-w-40 flex-1"
          aria-label="Search library"
          placeholder="Search memories and skills…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Entry type"
          className="h-10 rounded-md border bg-background px-3 text-sm"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All entries</option>
          <option value="memory">Memories</option>
          <option value="skill">Skills</option>
        </select>
      </div>
      <DemonstrationList
        key={`${botId}:${recordingRefresh}`}
        botId={botId}
        onReview={async (id) => {
          const result = await api<{ items: KnowledgeItem[] }>(`/api/bots/${botId}/knowledge`);
          const item = result.items.find((item) => item.id === id);
          if (!item) throw new Error("This draft was removed from the library");
          setItems(result.items);
          setEditor({ kind: item.kind, item });
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}{" "}
          <Button variant="link" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      )}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the library…
        </p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <PiBrain className="size-8 text-muted-foreground" />
          <h2 className="font-medium">
            {query ? "No matching entries" : "A little context goes a long way"}
          </h2>
          <p className="max-w-md px-5 text-sm text-muted-foreground">
            {query
              ? "Try a different search."
              : "Ask a teammate to remember a preference or save a useful method. You can review and change it here."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setEditor({ kind: item.kind, item })}
              className="flex flex-col gap-4 rounded-xl border bg-card p-5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex w-full items-center gap-2 text-sm font-medium">
                {item.kind === "memory" ? <PiBrain /> : <PiSparkle />}
                <span>{item.kind === "memory" ? "Memory" : item.name}</span>
                {item.kind === "skill" && (
                  <Badge className="ml-auto" variant="secondary">
                    {item.status === "draft" ? "Draft" : "Ready"}
                  </Badge>
                )}
              </div>
              <p className="line-clamp-4 text-sm leading-6">
                {item.kind === "memory" ? item.content : item.description}
              </p>
              <p className="mt-auto text-xs text-muted-foreground">
                Revision {item.revision} · {item.source}
              </p>
            </button>
          ))}
        </div>
      )}
      {editor && (
        <KnowledgeEditor
          key={`${botId}:${editor.item?.id ?? editor.kind}`}
          botId={botId}
          {...editor}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            await load();
            await controller.load();
          }}
        />
      )}
      {recording && (
        <RecordDemonstration
          key={botId}
          botId={botId}
          onClose={() => setRecording(false)}
          onSaved={async () => {
            setRecordingRefresh((value) => value + 1);
            await controller.load();
          }}
        />
      )}
    </section>
  );
}
