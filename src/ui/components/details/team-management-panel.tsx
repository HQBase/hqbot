import { type FormEvent, useEffect, useId, useState } from "react";
import { PiCheck, PiUsersThree } from "react-icons/pi";
import { toast } from "sonner";
import type { HQBotModel } from "../../../domain/models";
import { type TeamPolicy, teamPolicyInput } from "../../../domain/team-policy";
import { api, errorMessage } from "../../lib/api";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from "../ui/field";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

type PolicyView = { policy: TeamPolicy; models: HQBotModel[] };
export function TeamManagementPanel({ botId }: { botId: string }) {
  const [view, setView] = useState<PolicyView | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const id = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries the failed request.
  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setError("");
    void api<PolicyView>(`/api/bots/${botId}/team-management`, { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) {
          setView(result);
          setSaved(JSON.stringify(result.policy));
        }
      },
      (cause) => {
        if (!controller.signal.aborted)
          setError(errorMessage(cause, "Team settings could not load"));
      }
    );
    return () => controller.abort();
  }, [botId, attempt]);
  const policy = view?.policy;
  const dirty = Boolean(policy && JSON.stringify(policy) !== saved);
  function update(value: Partial<TeamPolicy>) {
    setView((current) =>
      current ? { ...current, policy: { ...current.policy, ...value } } : current
    );
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = teamPolicyInput.safeParse(policy);
    if (!parsed.success) {
      setError("Choose at least one model and check the limits below.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await api<{ policy: TeamPolicy }>(`/api/bots/${botId}/team-management`, {
        method: "PATCH",
        body: JSON.stringify(parsed.data)
      });
      setView((current) => (current ? { ...current, policy: result.policy } : current));
      setSaved(JSON.stringify(result.policy));
      toast.success("Team settings saved");
    } catch (cause) {
      setError(errorMessage(cause, "Team settings could not be saved"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <details className="group rounded-xl border border-divider bg-card p-3">
      <summary className="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <span className="inline-flex items-center gap-2 font-medium text-sm">
          <PiUsersThree className="size-4" />
          Team management
        </span>
        <Badge variant="secondary" className="ml-2">
          {policy?.canManage ? "Manager" : "Specialist"}
        </Badge>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          Delegation, hiring, models, and team limits.
        </span>
      </summary>
      <div className="mt-5 flex flex-col gap-4">
        {!view && !error && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading team settings
          </p>
        )}
        {!view && error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!view && error && (
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        )}
        {view && policy && (
          <form onSubmit={(event) => void save(event)}>
            <FieldSet disabled={saving}>
              <FieldGroup>
                <Field orientation="horizontal">
                  <input
                    className="mt-1 size-4 accent-primary"
                    type="checkbox"
                    id={`${id}-manage`}
                    checked={policy.canManage}
                    onChange={(event) =>
                      update({
                        canManage: event.target.checked,
                        ...(!event.target.checked
                          ? { canCreate: false, canCreateManagers: false }
                          : {})
                      })
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={`${id}-manage`}>Can manage work</FieldLabel>
                    <FieldDescription>
                      Assign work to teammates and review their results.
                    </FieldDescription>
                  </FieldContent>
                </Field>
                {policy.canManage && (
                  <>
                    <Field orientation="horizontal">
                      <input
                        className="mt-1 size-4 accent-primary"
                        type="checkbox"
                        id={`${id}-create`}
                        checked={policy.canCreate}
                        onChange={(event) =>
                          update({
                            canCreate: event.target.checked,
                            ...(!event.target.checked ? { canCreateManagers: false } : {})
                          })
                        }
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={`${id}-create`}>Can create teammates</FieldLabel>
                        <FieldDescription>
                          Create employees when a task needs them. Each gets a separate conversation
                          and private resources.
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                    {policy.canCreate && (
                      <Field orientation="horizontal">
                        <input
                          className="mt-1 size-4 accent-primary"
                          type="checkbox"
                          id={`${id}-managers`}
                          checked={policy.canCreateManagers}
                          onChange={(event) => update({ canCreateManagers: event.target.checked })}
                        />
                        <FieldContent>
                          <FieldLabel htmlFor={`${id}-managers`}>Can create managers</FieldLabel>
                          <FieldDescription>
                            New managers can delegate to specialists. Tasks allow two delegation
                            levels below their owner. Only you can give managers permission to hire.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    )}
                    <FieldSet>
                      <FieldLegend>Allowed team models</FieldLegend>
                      <FieldDescription>
                        Used for new employees and assignments. Models need known prices to enforce
                        the shared budget.
                      </FieldDescription>
                      <FieldGroup className="max-h-52 overflow-y-auto">
                        {view.models.map((model) => (
                          <Field orientation="horizontal" key={model.id}>
                            <input
                              className="size-4 shrink-0 accent-primary"
                              type="checkbox"
                              id={`${id}-${model.id}`}
                              checked={policy.allowedModelIds.includes(model.id)}
                              disabled={
                                policy.allowedModelIds.length === 1 &&
                                policy.allowedModelIds[0] === model.id
                              }
                              onChange={(event) => {
                                const allowedModelIds = event.target.checked
                                  ? [...policy.allowedModelIds, model.id]
                                  : policy.allowedModelIds.filter((value) => value !== model.id);
                                update({
                                  allowedModelIds,
                                  defaultModelId: allowedModelIds.includes(policy.defaultModelId)
                                    ? policy.defaultModelId
                                    : allowedModelIds[0]
                                });
                              }}
                            />
                            <FieldLabel htmlFor={`${id}-${model.id}`}>{model.label}</FieldLabel>
                          </Field>
                        ))}
                      </FieldGroup>
                    </FieldSet>
                    <Field>
                      <FieldLabel htmlFor={`${id}-default`}>Default for new teammates</FieldLabel>
                      <select
                        id={`${id}-default`}
                        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        value={policy.defaultModelId}
                        onChange={(event) => update({ defaultModelId: event.target.value })}
                      >
                        {policy.allowedModelIds.map((modelId) => (
                          <option key={modelId} value={modelId}>
                            {view.models.find((model) => model.id === modelId)?.label ?? modelId}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {policy.canCreate && (
                      <Field>
                        <FieldLabel htmlFor={`${id}-employees`}>Maximum employees</FieldLabel>
                        <Input
                          id={`${id}-employees`}
                          required
                          type="number"
                          min={1}
                          max={30}
                          step={1}
                          value={policy.maxEmployees}
                          onChange={(event) => update({ maxEmployees: Number(event.target.value) })}
                        />
                        <FieldDescription>
                          Active employees created by this manager.
                        </FieldDescription>
                      </Field>
                    )}
                    <Field>
                      <FieldLabel htmlFor={`${id}-concurrent`}>Work branches at once</FieldLabel>
                      <Input
                        id={`${id}-concurrent`}
                        required
                        type="number"
                        min={1}
                        max={12}
                        step={1}
                        value={policy.maxConcurrent}
                        onChange={(event) => update({ maxConcurrent: Number(event.target.value) })}
                      />
                      <FieldDescription>
                        A manager can pass a branch to a specialist within this limit.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`${id}-budget`}>Daily team budget (USD)</FieldLabel>
                      <Input
                        id={`${id}-budget`}
                        required
                        type="number"
                        min={0.1}
                        max={50}
                        step={0.1}
                        value={policy.dailyBudgetUsd}
                        onChange={(event) => update({ dailyBudgetUsd: Number(event.target.value) })}
                      />
                      <FieldDescription>
                        Shared by all tasks this manager owns. Workspace and teammate limits still
                        apply. Resets at midnight UTC.
                      </FieldDescription>
                    </Field>
                  </>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button className="self-start" size="sm" disabled={saving || !dirty} type="submit">
                  {saving ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <PiCheck data-icon="inline-start" />
                  )}
                  {saving ? "Saving…" : "Save team settings"}
                </Button>
              </FieldGroup>
            </FieldSet>
          </form>
        )}
      </div>
    </details>
  );
}
