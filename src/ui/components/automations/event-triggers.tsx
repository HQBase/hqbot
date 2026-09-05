import { useCallback, useEffect, useState } from "react";
import { PiCopy, PiPlus, PiTrash } from "react-icons/pi";
import type { Automation } from "../../../domain/automations";
import type { EventReceipt, EventTrigger } from "../../../domain/events";
import { api, errorMessage } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { TriggerEditor } from "./trigger-editor";

export function EventTriggers({ routine }: { routine: Automation }) {
  const [items, setItems] = useState<EventTrigger[]>([]);
  const [editor, setEditor] = useState<EventTrigger | "new" | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<{ id: string; events: EventReceipt[] } | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await api<{ triggers: EventTrigger[] }>(
          `/api/event-triggers?routineId=${encodeURIComponent(routine.id)}`,
          { signal }
        );
        if (!signal?.aborted) {
          setItems(result.triggers);
          setError("");
        }
      } catch (cause) {
        if (!signal?.aborted) setError(errorMessage(cause, "Triggers could not load"));
      }
    },
    [routine.id]
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Incoming events</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Start this routine when a selected service sends an event.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditor("new")}>
          <PiPlus /> Add trigger
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!items.length && (
        <p className="text-sm text-muted-foreground">
          Add a trigger, then enter its URL and signing key in your service.
        </p>
      )}
      {items.map((item) => (
        <div key={item.id} className="flex flex-col gap-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{item.filter.provider}</Badge>
            <span className="font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">{item.enabled ? "On" : "Paused"}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditor(item)}>
              Edit
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete ${item.name}`}
              disabled={pending}
              onClick={async () => {
                if (
                  !window.confirm("Delete this event trigger? Its URL will stop accepting events.")
                )
                  return;
                setPending(true);
                try {
                  await api(`/api/event-triggers/${item.id}`, { method: "DELETE" });
                  await load();
                } catch (cause) {
                  setError(errorMessage(cause, "Trigger could not be deleted"));
                } finally {
                  setPending(false);
                }
              }}
            >
              <PiTrash />
            </Button>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <code className="truncate text-xs text-muted-foreground">
              {location.origin}/events/{item.id}
            </code>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Copy event URL"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${location.origin}/events/${item.id}`);
                } catch {
                  setError("The URL could not be copied. Select and copy it.");
                }
              }}
            >
              <PiCopy />
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                const result = await api<{ events: EventReceipt[] }>(
                  `/api/event-triggers/${item.id}`
                );
                setHistory({ id: item.id, events: result.events });
              } catch (cause) {
                setError(errorMessage(cause, "Event history could not load"));
              } finally {
                setPending(false);
              }
            }}
          >
            Recent deliveries
          </Button>
          {history?.id === item.id && (
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              {history.events.length ? (
                history.events.map((event) => (
                  <p key={event.id}>
                    {new Date(event.createdAt).toLocaleString()} · {event.state} · {event.id}
                  </p>
                ))
              ) : (
                <p>No deliveries yet.</p>
              )}
            </div>
          )}
        </div>
      ))}
      {editor && (
        <TriggerEditor
          key={editor === "new" ? "new" : editor.id}
          routine={routine}
          trigger={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
          onSaved={load}
        />
      )}
    </section>
  );
}
