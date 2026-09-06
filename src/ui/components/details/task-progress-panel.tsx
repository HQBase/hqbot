import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { ActivityEvidence, ActivityStatus, ActivityTime } from "./activity-parts";

interface ProgressView {
  work: { goal: string; state: string; lastError: string | null; wakeAt?: string | null };
  criteria: { id: string; description: string; artifactName?: string }[];
  milestones: {
    id: string;
    state: string;
    checkpoint: string;
    evidence: string | null;
    created_at: string;
  }[];
}
export function TaskProgressPanel({
  botId,
  revision,
  hideEmpty = false
}: {
  botId: string;
  revision?: string;
  hideEmpty?: boolean;
}) {
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<ProgressView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    setView(null);
    setError("");
    const controller = new AbortController();
    void api<ProgressView | null>(
      `/api/bots/${botId}/task-progress?revision=${encodeURIComponent(`${revision ?? ""}:${refresh}`)}`,
      { signal: controller.signal }
    ).then(
      (result) => {
        if (!controller.signal.aborted) {
          setView(result);
          setLoading(false);
        }
      },
      (cause) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(cause, "Progress could not load"));
          setLoading(false);
        }
      }
    );
    return () => controller.abort();
  }, [botId, revision, refresh]);
  if (hideEmpty && !view && !error && !loading) return null;
  return (
    <section aria-label="Task progress" className="flex flex-col gap-5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Saved work and completion checks</p>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="py-8 text-center text-muted-foreground">
          Loading progress…
        </p>
      ) : view ? (
        <>
          <Card>
            <CardHeader>
              <div>
                <ActivityStatus state={view.work.state} />
              </div>
              <CardTitle className="break-words leading-snug">{view.work.goal}</CardTitle>
              {view.work.wakeAt && (
                <CardDescription>
                  Next wake <ActivityTime value={view.work.wakeAt} />
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {view.work.lastError && (
                <p role="status" className="mb-4 whitespace-pre-wrap break-words">
                  {view.work.lastError}
                </p>
              )}
              {view.work.state === "cancelled" && !view.work.lastError && (
                <p className="mb-4 text-muted-foreground">Cancellation reason was not recorded.</p>
              )}
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">Completion checks</h3>
              <ul className="flex list-disc flex-col gap-3 pl-4">
                {view.criteria.map((item) => (
                  <li key={item.id}>
                    {item.description}
                    {item.artifactName && (
                      <span className="mt-1 block break-words text-xs text-muted-foreground">
                        {item.artifactName}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">Timeline</h3>
            {view.milestones.map((item) => (
              <details key={item.id} className="rounded-xl border border-divider bg-card p-3">
                <summary className="cursor-pointer">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <ActivityStatus state={item.state} />
                    <ActivityTime value={item.created_at} />
                  </span>
                </summary>
                <div className="mt-4 flex flex-col gap-3 text-sm leading-relaxed">
                  <p className="whitespace-pre-wrap break-words">{item.checkpoint}</p>
                  {item.evidence && <ActivityEvidence value={item.evidence} />}
                </div>
              </details>
            ))}
          </div>
        </>
      ) : (
        !error && (
          <div className="py-10 text-center">
            <p className="font-medium">No saved task yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Work that continues in the background appears here.
            </p>
          </div>
        )
      )}
    </section>
  );
}
