import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";

interface ProgressView {
  work: { goal: string; state: string; lastError: string | null };
  criteria: { id: string; description: string; artifactName?: string }[];
  milestones: {
    id: string;
    state: string;
    checkpoint: string;
    evidence: string | null;
    created_at: string;
  }[];
}
export function TaskProgressPanel({ botId, revision }: { botId: string; revision?: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ProgressView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void api<ProgressView | null>(
      `/api/bots/${botId}/task-progress?revision=${encodeURIComponent(revision ?? "")}`,
      { signal: controller.signal }
    ).then(
      (result) => {
        if (!controller.signal.aborted) setView(result);
      },
      (cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause, "Progress could not load"));
      }
    );
    return () => controller.abort();
  }, [botId, open, revision]);
  return (
    <section className="border-t border-divider py-4 text-xs">
      <button type="button" className="font-medium" onClick={() => setOpen(!open)}>
        Task progress
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {error && <p role="alert">{error}</p>}
          {view ? (
            <>
              <p>
                {view.work.goal} · {view.work.state}
              </p>
              {view.work.lastError && <p role="status">{view.work.lastError}</p>}
              <p className="font-medium">Completion criteria</p>
              <ul className="list-disc pl-4">
                {view.criteria.map((item) => (
                  <li key={item.id}>
                    {item.description}
                    {item.artifactName ? ` (${item.artifactName})` : ""}
                  </li>
                ))}
              </ul>
              <p className="font-medium">Saved milestones</p>
              {view.milestones.map((item) => (
                <details key={item.id} className="rounded border p-2">
                  <summary>
                    {item.state} · {new Date(item.created_at).toLocaleString()}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap">{item.checkpoint}</p>
                  {item.evidence && (
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">
                      {item.evidence}
                    </pre>
                  )}
                </details>
              ))}
            </>
          ) : (
            <p>No saved task yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
