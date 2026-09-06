import { useEffect, useState } from "react";
import type { ComputerApproval, ComputerPolicy } from "../../../domain/computer-review";
import { api, errorMessage } from "../../lib/api";
import { ComputerApprovalCard } from "../chat/computer-approval-card";
import { Button } from "../ui/button";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { PermissionRulesPanel } from "./permission-rules-panel";

interface PermissionView {
  policy: ComputerPolicy;
  approvals: ComputerApproval[];
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
                  <option value="autonomous">Autonomous · ask before consequential actions</option>
                  <option value="review">Strict · approve each computer action</option>
                  <option value="allow">Full access · no automatic approval checks</option>
                </select>
                <FieldDescription>
                  Autonomous allows routine computer work. An independent check asks before sending,
                  publishing, spending, destructive changes, access changes, or unclear actions. The
                  check can make mistakes; Strict offers more control. Full access includes
                  signed-in sites. Your scoped rules take precedence. Connected tools keep separate
                  permissions.
                </FieldDescription>
              </Field>
              {view.approvals.map((item) => (
                <ComputerApprovalCard
                  key={item.executionId}
                  approval={item}
                  pending={busy}
                  onDeny={() =>
                    void save({
                      executionId: item.executionId,
                      inputHash: item.inputHash,
                      approved: false
                    })
                  }
                  onApprove={() =>
                    void save({
                      executionId: item.executionId,
                      inputHash: item.inputHash,
                      approved: true
                    })
                  }
                />
              ))}
              <PermissionRulesPanel botId={botId} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
