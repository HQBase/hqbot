import { useCallback, useEffect, useRef, useState } from "react";
import type { Automation, RoutineRun } from "../../../domain/automations";
import { api, errorMessage } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export function RoutineRuns({
  routine,
  onOpenConversation
}: {
  routine: Automation;
  onOpenConversation: () => void;
}) {
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const testId = useRef(crypto.randomUUID());
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await api<{ runs: RoutineRun[]; nextRunAt: string | null }>(
          `/api/bots/${routine.botId}/routines/${routine.id}/runs`,
          { signal }
        );
        if (!signal?.aborted) {
          setRuns(result.runs);
          setNextRunAt(result.nextRunAt);
        }
      } catch (cause) {
        if (!signal?.aborted) setError(errorMessage(cause, "Run history could not load"));
      }
    },
    [routine.botId, routine.id]
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);
  async function test() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/bots/${routine.botId}/routines/${routine.id}/run`, {
        method: "POST",
        body: JSON.stringify({ id: testId.current })
      });
      testId.current = crypto.randomUUID();
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "The test could not start"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">Run history</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onOpenConversation}>
            Open conversation
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void test()}>
            {busy ? "Starting…" : "Test now"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        A test uses the same budget and permissions. Queued work waits for the teammate to be free.
      </p>
      {nextRunAt && (
        <p className="text-sm">
          Next run in your time zone: {new Date(nextRunAt).toLocaleString()}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!runs.length && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No runs yet. Test the routine to check its result.
        </p>
      )}
      {runs.map((run) => (
        <details key={run.id} className="rounded-xl border bg-card p-4">
          <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
            <time>{new Date(run.createdAt).toLocaleString()}</time>
            <span className="text-muted-foreground">
              {run.source === "manual" ? "Test" : run.source === "event" ? "Event" : "Scheduled"}
            </span>
            <Badge
              className="ml-auto"
              variant={run.state === "failed" ? "destructive" : "secondary"}
            >
              {run.state === "submitted" ? "Running" : run.state}
            </Badge>
          </summary>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
            {run.result ??
              (run.state === "queued"
                ? "Waiting for available capacity and budget."
                : "Open the conversation for progress or an approval request.")}
          </p>
        </details>
      ))}
    </div>
  );
}
