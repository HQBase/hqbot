import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { PermissionRulesPanel } from "./permission-rules-panel";

interface PermissionView {
  policy: "review" | "allow";
  approvals: { executionId: string; action: string; input: unknown; inputHash: string }[];
}
export function ComputerPermissionsPanel({
  botId,
  needsApproval,
  embedded = false
}: {
  botId: string;
  needsApproval: boolean;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(embedded);
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
    <section className="py-4 text-sm">
      {!embedded && (
        <Button variant="ghost" onClick={() => setOpen(!open)}>
          Permissions{view?.approvals.length ? ` · ${view.approvals.length} waiting` : ""}
        </Button>
      )}
      {(open || needsApproval) && (
        <div className="flex flex-col gap-5">
          {error && <p role="alert">{error}</p>}
          {!view && !error && <p role="status">Loading permissions…</p>}
          {view && (
            <>
              <Field>
                <FieldLabel htmlFor="computer-policy">Computer access</FieldLabel>
                <select
                  id="computer-policy"
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={view.policy}
                  disabled={busy}
                  onChange={(event) => void save({ policy: event.target.value })}
                >
                  <option value="review">Review computer actions</option>
                  <option value="allow">Allow computer actions</option>
                </select>
                <FieldDescription>
                  Review asks before code runs, browser or desktop input changes, and file deletion.
                  Allow grants these actions to this teammate, including use of signed-in sites.
                  Scoped rules can require review, allow an action, or block it. Connected tools
                  require review by default.
                </FieldDescription>
              </Field>
              {view.approvals.map((item) => (
                <div
                  key={item.executionId}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-4"
                >
                  <strong>{item.action}</strong>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(item.input, null, 2)}
                  </pre>
                  <div className="flex gap-4">
                    <Button
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
                    </Button>
                    <Button
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
                    </Button>
                  </div>
                </div>
              ))}
              <PermissionRulesPanel botId={botId} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
