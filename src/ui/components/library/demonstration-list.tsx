import { useCallback, useEffect, useState } from "react";
import type { Demonstration } from "../../../domain/demonstrations";
import { api, errorMessage } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export function DemonstrationList({
  botId,
  onReview
}: {
  botId: string;
  onReview: (skillId: string) => Promise<void>;
}) {
  const [items, setItems] = useState<Demonstration[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!botId) return;
      try {
        const result = await api<{ demonstrations: Demonstration[] }>(
          `/api/bots/${botId}/demonstrations`,
          { signal }
        );
        if (!signal?.aborted) setItems(result.demonstrations);
      } catch (cause) {
        if (!signal?.aborted) setError(errorMessage(cause, "Recordings could not load"));
      }
    },
    [botId]
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);
  if (!items.length && !error) return null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <h2 className="font-medium">Recorded demonstrations</h2>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {items.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center gap-3 border-t pt-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{item.name}</p>
            {item.error && <p className="mt-1 text-xs text-destructive">{item.error}</p>}
          </div>
          <Badge variant="secondary">
            {item.state === "ready"
              ? "Draft ready"
              : item.state === "building"
                ? "Creating draft"
                : item.state}
          </Badge>
          {item.skillId && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await onReview(item.skillId ?? "");
                } catch (cause) {
                  setError(errorMessage(cause, "Draft could not open"));
                } finally {
                  setPending(false);
                }
              }}
            >
              Review draft
            </Button>
          )}
          {item.state === "failed" && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await api(`/api/bots/${botId}/demonstrations/${item.id}/retry`, {
                    method: "POST"
                  });
                  await load();
                } catch (cause) {
                  setError(errorMessage(cause, "Retry could not start"));
                } finally {
                  setPending(false);
                }
              }}
            >
              Try again
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
