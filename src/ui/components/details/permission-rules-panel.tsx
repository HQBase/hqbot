import { type FormEvent, useEffect, useState } from "react";
import type { PermissionRule, PermissionRuleInput } from "../../../domain/permissions";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

interface RulesView {
  rules: PermissionRule[];
  connections: { connector: string; label: string; actions: string[] }[];
}
const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
export function PermissionRulesPanel({ botId }: { botId: string }) {
  const [view, setView] = useState<RulesView>({ rules: [], connections: [] });
  const [editor, setEditor] = useState<PermissionRule | "new" | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<RulesView>(`/api/bots/${botId}/permission-rules?revision=${revision}`, {
      signal: controller.signal
    }).then(setView, (cause) => {
      if (!controller.signal.aborted) setError(errorMessage(cause, "Rules could not load"));
    });
    return () => controller.abort();
  }, [botId, revision]);
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="font-medium">Scoped rules</strong>
        <Button variant="outline" size="sm" onClick={() => setEditor("new")}>
          Add rule
        </Button>
      </div>
      <p className="text-muted-foreground">
        Allow familiar actions. Require review for sensitive steps. A block always wins.
      </p>
      {error && <p role="alert">{error}</p>}
      {!view.rules.length && (
        <p className="text-muted-foreground">No rules yet. Your default permissions apply.</p>
      )}
      {view.rules.map((rule) => (
        <div key={rule.id} className="flex flex-col gap-2 rounded-lg border p-3">
          <strong>{rule.label}</strong>
          <p className="break-all text-muted-foreground">
            {rule.decision === "deny" ? "Block" : rule.decision === "review" ? "Review" : "Allow"} ·{" "}
            {rule.action}
          </p>
          <p className="text-muted-foreground">
            {rule.taskId ? "One task · " : ""}
            {rule.expiresAt
              ? `Expires ${new Date(rule.expiresAt).toLocaleString()}`
              : "Until removed"}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditor(rule)}>
              Edit
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              size="sm"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api(`/api/bots/${botId}/permission-rules`, {
                    method: "DELETE",
                    body: JSON.stringify({ id: rule.id })
                  });
                  setRevision((value) => value + 1);
                } catch (cause) {
                  setError(errorMessage(cause, "The rule could not be removed"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      {editor && (
        <RuleEditor
          key={editor === "new" ? "new" : editor.id}
          botId={botId}
          view={view}
          rule={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setRevision((value) => value + 1);
            setEditor(null);
          }}
        />
      )}
    </div>
  );
}
function RuleEditor({
  botId,
  view,
  rule,
  onClose,
  onSaved
}: {
  botId: string;
  view: RulesView;
  rule?: PermissionRule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(rule?.label ?? "");
  const [connector, setConnector] = useState(rule?.connector ?? "computer");
  const [action, setAction] = useState(rule?.action ?? "browser_open");
  const [decision, setDecision] = useState<PermissionRuleInput["decision"]>(
    rule?.decision ?? "allow"
  );
  const [scope, setScope] = useState(rule?.scope.kind ?? "origin");
  const [field, setField] = useState(
    rule?.scope.kind === "field"
      ? rule.scope.path.join(".")
      : rule?.scope.kind === "origin"
        ? rule.scope.field
        : "url"
  );
  const [value, setValue] = useState(
    rule?.scope.kind === "origin"
      ? rule.scope.origin
      : rule?.scope.kind === "field" || rule?.scope.kind === "exact"
        ? JSON.stringify(rule.scope.value)
        : ""
  );
  const [expiry, setExpiry] = useState(rule ? "keep" : "day");
  const [taskId, setTaskId] = useState(rule?.taskId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const actions = view.connections.find((item) => item.connector === connector)?.actions ?? [];
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      let parsed: unknown = value;
      if (scope === "field") {
        try {
          parsed = JSON.parse(value);
        } catch {
          /* Plain text is a string value. */
        }
      }
      if (scope === "exact") parsed = JSON.parse(value);
      const days = expiry === "hour" ? 1 / 24 : expiry === "week" ? 7 : 1;
      await api(`/api/bots/${botId}/permission-rules`, {
        method: "POST",
        body: JSON.stringify({
          id: rule?.id,
          label,
          connector,
          action,
          decision,
          taskId: taskId.trim() || null,
          expiresAt:
            expiry === "keep"
              ? (rule?.expiresAt ?? null)
              : expiry === "never"
                ? null
                : new Date(Date.now() + days * 86400000).toISOString(),
          scope:
            scope === "any"
              ? { kind: "any" }
              : scope === "origin"
                ? { kind: "origin", field, origin: value }
                : scope === "field"
                  ? { kind: "field", path: field.split("."), value: parsed }
                  : { kind: "exact", value: parsed }
        })
      });
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, "The rule could not be saved"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit permission rule" : "New permission rule"}</DialogTitle>
          <DialogDescription>
            Choose one action and the input it can use. Rules affect future actions.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={(event) => void save(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="rule-label">Name</FieldLabel>
              <Input
                id="rule-label"
                value={label}
                required
                maxLength={100}
                placeholder="Browse our help center"
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rule-connection">Connection</FieldLabel>
                <select
                  id="rule-connection"
                  className={selectClass}
                  value={connector}
                  onChange={(event) => {
                    setConnector(event.target.value);
                    setAction(
                      view.connections.find((item) => item.connector === event.target.value)
                        ?.actions[0] ?? ""
                    );
                    setScope("field");
                    setField("");
                    setValue("");
                  }}
                >
                  {view.connections.map((item) => (
                    <option key={item.connector} value={item.connector}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="rule-action">Action</FieldLabel>
                <select
                  id="rule-action"
                  className={selectClass}
                  value={action}
                  required
                  onChange={(event) => setAction(event.target.value)}
                >
                  {!actions.includes(action) && <option value={action}>{action}</option>}
                  {actions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="rule-decision">Permission</FieldLabel>
              <select
                id="rule-decision"
                className={selectClass}
                value={decision}
                onChange={(event) =>
                  setDecision(event.target.value as PermissionRuleInput["decision"])
                }
              >
                <option value="allow">Allow without asking</option>
                <option value="review">Ask each time</option>
                <option value="deny">Block</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="rule-scope">Apply to</FieldLabel>
              <select
                id="rule-scope"
                className={selectClass}
                value={scope}
                onChange={(event) => setScope(event.target.value as typeof scope)}
              >
                <option value="origin">One website</option>
                <option value="field">One input value</option>
                <option value="exact">Exact input</option>
                <option value="any">Any input for this action</option>
              </select>
            </Field>
            {(scope === "field" || scope === "origin") && (
              <Field>
                <FieldLabel htmlFor="rule-field">Input field</FieldLabel>
                <Input
                  id="rule-field"
                  value={field}
                  required
                  maxLength={100}
                  placeholder={scope === "origin" ? "url" : "mailboxId"}
                  onChange={(event) => setField(event.target.value)}
                />
              </Field>
            )}
            {scope !== "any" && (
              <Field>
                <FieldLabel htmlFor="rule-value">
                  {scope === "origin"
                    ? "Website origin"
                    : scope === "exact"
                      ? "Input (JSON)"
                      : "Required value"}
                </FieldLabel>
                {scope === "exact" ? (
                  <Textarea
                    id="rule-value"
                    value={value}
                    required
                    onChange={(event) => setValue(event.target.value)}
                  />
                ) : (
                  <Input
                    id="rule-value"
                    value={value}
                    required
                    placeholder={
                      scope === "origin" ? "https://example.com" : "Value from the action details"
                    }
                    onChange={(event) => setValue(event.target.value)}
                  />
                )}
              </Field>
            )}
            {scope === "any" && (
              <p className="rounded-lg bg-muted p-3 text-sm">
                This covers every input sent to this action, including new targets.
              </p>
            )}
            <Field>
              <FieldLabel htmlFor="rule-expiry">Expires</FieldLabel>
              <select
                id="rule-expiry"
                className={selectClass}
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
              >
                {rule && <option value="keep">Keep current expiry</option>}
                <option value="hour">In one hour</option>
                <option value="day">In 24 hours</option>
                <option value="week">In one week</option>
                <option value="never">When I remove it</option>
              </select>
            </Field>
            <details>
              <summary className="cursor-pointer text-sm">Limit to one task</summary>
              <Field className="mt-3">
                <FieldLabel htmlFor="rule-task">Task ID (optional)</FieldLabel>
                <Input
                  id="rule-task"
                  value={taskId}
                  maxLength={300}
                  onChange={(event) => setTaskId(event.target.value)}
                />
              </Field>
            </details>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" disabled={busy} variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !action}>
              {busy ? "Saving…" : "Save rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
