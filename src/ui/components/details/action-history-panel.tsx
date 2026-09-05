import { useEffect, useState } from "react";
import type { ActionRecord } from "../../../domain/actions";
import { api, errorMessage } from "../../lib/api";

export function ActionHistoryPanel({ botId }: { botId: string }) {
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void api<{ actions: ActionRecord[] }>(`/api/bots/${botId}/actions?revision=${revision}`, {
      signal: controller.signal
    }).then(
      (result) => {
        if (!controller.signal.aborted) setActions(result.actions);
      },
      (cause) => {
        if (!controller.signal.aborted)
          setError(errorMessage(cause, "Action history could not load"));
      }
    );
    return () => controller.abort();
  }, [botId, open, revision]);
  return (
    <section className="border-t border-divider py-4 text-xs">
      <button type="button" className="font-medium" onClick={() => setOpen(!open)}>
        Action history
      </button>
      {error && <p role="alert">{error}</p>}
      {open && (
        <div className="mt-3 space-y-3">
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            Refresh
          </button>
          {!actions.length && <p>No connected actions yet.</p>}
          {actions.map((action) => (
            <details key={action.id} className="rounded border border-divider p-2">
              <summary>
                {action.method} · {action.state}
              </summary>
              <p className="mt-2 break-all">
                {action.connector} · call {action.seq} · {action.updatedAt}
              </p>
              <p>Approved input</p>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(action.args, null, 2)}
              </pre>
              <p>Result</p>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(action.result, null, 2)}
              </pre>
              {action.state === "uncertain" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void api(`/api/bots/${botId}/actions/resolve`, {
                      method: "POST",
                      body: JSON.stringify({
                        id: action.id,
                        evidence: data.get("evidence"),
                        happened: data.get("happened") === "yes"
                      })
                    }).then(
                      () => setRevision((value) => value + 1),
                      (cause) => setError(errorMessage(cause, "The outcome could not be saved"))
                    );
                  }}
                  className="space-y-2"
                >
                  <p>Check the service before recording an outcome. This resumes the task.</p>
                  <select
                    name="happened"
                    aria-label="Checked outcome"
                    className="w-full bg-transparent"
                  >
                    <option value="yes">The action completed</option>
                    <option value="no">The action did not happen</option>
                  </select>
                  <textarea
                    required
                    name="evidence"
                    aria-label="Outcome evidence"
                    maxLength={20000}
                    placeholder="What did you check? Include the result or record ID."
                    className="w-full rounded border bg-transparent p-2"
                  />
                  <button type="submit">Save checked outcome</button>
                </form>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
