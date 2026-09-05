import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";

interface PermissionView {
  policy: "review" | "allow";
  approvals: { executionId: string; action: string; input: unknown; inputHash: string }[];
}
export function ComputerPermissionsPanel({
  botId,
  needsApproval
}: {
  botId: string;
  needsApproval: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PermissionView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open && !needsApproval) return;
    const controller = new AbortController();
    const load = () =>
      api<PermissionView>(`/api/bots/${botId}/computer-permissions?revision=${revision}`, {
        signal: controller.signal
      }).then(
        (result) => {
          if (!controller.signal.aborted) setView(result);
        },
        (cause) => {
          if (!controller.signal.aborted)
            setError(errorMessage(cause, "Permissions could not load"));
        }
      );
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [botId, open, needsApproval, revision]);
  async function save(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/bots/${botId}/computer-permissions`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(errorMessage(cause, "The decision could not be saved"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="border-t border-divider py-4 text-xs">
      <button type="button" className="font-medium" onClick={() => setOpen(!open)}>
        Computer permissions{view?.approvals.length ? ` · ${view.approvals.length} waiting` : ""}
      </button>
      {(open || needsApproval) && (
        <div className="mt-3 space-y-3">
          {error && <p role="alert">{error}</p>}
          {view && (
            <>
              <label className="block">
                Permission for this teammate
                <select
                  className="mt-2 w-full rounded border bg-transparent p-2"
                  value={view.policy}
                  disabled={busy}
                  onChange={(event) => void save({ policy: event.target.value })}
                >
                  <option value="review">Review computer actions</option>
                  <option value="allow">Allow computer actions</option>
                </select>
              </label>
              <p>
                Review asks before code runs, browser or desktop input changes, and file deletion.
                Allow grants these actions to this teammate, including use of signed-in sites.
                Connected service tools still need approval.
              </p>
              {view.approvals.map((item) => (
                <div key={item.executionId} className="space-y-2 rounded border p-2">
                  <strong>{item.action}</strong>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(item.input, null, 2)}
                  </pre>
                  <div className="flex gap-4">
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void save({
                          executionId: item.executionId,
                          inputHash: item.inputHash,
                          approved: false
                        })
                      }
                    >
                      Deny
                    </button>
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void save({
                          executionId: item.executionId,
                          inputHash: item.inputHash,
                          approved: true
                        })
                      }
                    >
                      Approve exact action
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
