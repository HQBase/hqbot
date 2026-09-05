import { useEffect, useState } from "react";
import type { ActionRecord } from "../../../domain/actions";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../ui/field";
import { Textarea } from "../ui/textarea";
import { ActivityStatus, ActivityTime } from "./activity-parts";

export function ActionHistoryPanel({ botId }: { botId: string }) {
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setActions([]);
    void api<{ actions: ActionRecord[] }>(`/api/bots/${botId}/actions?revision=${revision}`, {
      signal: controller.signal
    }).then(
      (result) => {
        if (!controller.signal.aborted) {
          setActions(result.actions);
          setLoading(false);
        }
      },
      (cause) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(cause, "Action history could not load"));
          setLoading(false);
        }
      }
    );
    return () => controller.abort();
  }, [botId, revision]);
  return (
    <section aria-label="Action history" className="flex flex-col gap-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Connected-service actions</p>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading || saving}
          onClick={() => setRevision((value) => value + 1)}
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
          Loading actions…
        </p>
      ) : (
        !actions.length &&
        !error && (
          <div className="py-10 text-center">
            <p className="font-medium">No connected actions yet</p>
            <p className="mt-2 text-muted-foreground">
              Service requests and their confirmed outcomes appear here.
            </p>
          </div>
        )
      )}
      {actions.map((action) => (
        <details
          key={action.id}
          className="rounded-xl border border-divider bg-card p-4"
          open={action.state === "uncertain" || undefined}
        >
          <summary className="cursor-pointer">
            <span className="inline-flex max-w-full flex-col gap-2 align-top">
              <span className="break-words font-medium">{action.method.replaceAll("_", " ")}</span>
              <span className="flex flex-wrap items-center gap-2">
                <ActivityStatus state={action.state} />
                <ActivityTime value={action.updatedAt} />
              </span>
            </span>
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <p className="break-words text-xs text-muted-foreground">{action.connector}</p>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Input and result
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-xs font-medium">Requested input</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">
                  {JSON.stringify(action.args, null, 2)}
                </pre>
                <p className="text-xs font-medium">Recorded result</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">
                  {JSON.stringify(action.result, null, 2) ?? "No result recorded yet."}
                </pre>
                <p className="break-all text-xs text-muted-foreground">Action ID: {action.id}</p>
              </div>
            </details>
            {action.state === "uncertain" && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (saving) return;
                  const data = new FormData(event.currentTarget);
                  setSaving(true);
                  setError("");
                  try {
                    await api(`/api/bots/${botId}/actions/resolve`, {
                      method: "POST",
                      body: JSON.stringify({
                        id: action.id,
                        evidence: data.get("evidence"),
                        happened: data.get("happened") === "yes"
                      })
                    });
                    setRevision((value) => value + 1);
                  } catch (cause) {
                    setError(errorMessage(cause, "The outcome could not be saved"));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`outcome-${action.id}`}>Check the outcome</FieldLabel>
                    <FieldDescription>
                      Check the service before saving. This resumes the task.
                    </FieldDescription>
                    <select
                      id={`outcome-${action.id}`}
                      name="happened"
                      disabled={saving}
                      className="h-10 w-full rounded-md border bg-background px-3"
                    >
                      <option value="yes">The action completed</option>
                      <option value="no">The action did not happen</option>
                    </select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`evidence-${action.id}`}>What did you verify?</FieldLabel>
                    <Textarea
                      id={`evidence-${action.id}`}
                      required
                      disabled={saving}
                      name="evidence"
                      maxLength={20000}
                      placeholder="Include the result or record ID."
                    />
                  </Field>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save checked outcome"}
                  </Button>
                </FieldGroup>
              </form>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
