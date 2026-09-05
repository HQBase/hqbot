import { useCallback, useEffect, useState } from "react";
import type { Automation } from "../../../domain/automations";
import type { KnowledgeItem } from "../../../domain/knowledge";
import {
  parseTemplate,
  type TeammateTemplate,
  type TemplateShare
} from "../../../domain/templates";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { TemplateReview } from "./template-review";

export function TemplatesPage({
  controller,
  onBack,
  onConversation
}: {
  controller: WorkspaceController;
  onBack: () => void;
  onConversation: () => void;
}) {
  const [botId, setBotId] = useState(
    controller.selectedBot?.id ?? controller.snapshot?.bots[0]?.id ?? ""
  );
  const [skills, setSkills] = useState<KnowledgeItem[]>([]);
  const [routines, setRoutines] = useState<Automation[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [shares, setShares] = useState<TemplateShare[]>([]);
  const [review, setReview] = useState<{ template: TeammateTemplate; own: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loadShares = useCallback(async () => {
    try {
      setShares((await api<{ shares: TemplateShare[] }>("/api/templates/shares")).shares);
    } catch (cause) {
      setError(errorMessage(cause, "Shared templates could not load"));
    }
  }, []);
  useEffect(() => {
    void loadShares();
  }, [loadShares]);
  useEffect(() => {
    const abort = new AbortController();
    setSelected([]);
    setSkills([]);
    setRoutines([]);
    if (!botId) return;
    void Promise.all([
      api<{ items: KnowledgeItem[] }>(`/api/bots/${botId}/knowledge`, { signal: abort.signal }),
      api<{ routines: Automation[] }>(`/api/automations?botId=${botId}`, { signal: abort.signal })
    ])
      .then(([knowledge, automations]) => {
        if (!abort.signal.aborted) {
          setSkills(knowledge.items.filter((item) => item.kind === "skill"));
          setRoutines(automations.routines);
        }
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(errorMessage(cause, "Template resources could not load"));
      });
    return () => abort.abort();
  }, [botId]);
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ template: TeammateTemplate }>("/api/templates/export", {
        method: "POST",
        body: JSON.stringify({
          botId,
          skillIds: skills.filter((item) => selected.includes(item.id)).map((item) => item.id),
          routineIds: routines.filter((item) => selected.includes(item.id)).map((item) => item.id)
        })
      });
      setReview({ template: result.template, own: true });
    } catch (cause) {
      setError(errorMessage(cause, "The template could not be prepared"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-4xl space-y-6 p-5 sm:p-8">
      <Button variant="ghost" onClick={onBack}>
        ← Library
      </Button>
      <div>
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reuse a teammate setup. Choose the skills and routines to include.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="space-y-4 rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">From a teammate</h2>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="template-bot">Teammate</FieldLabel>
              <select
                id="template-bot"
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={botId}
                onChange={(event) => setBotId(event.target.value)}
              >
                {controller.snapshot?.bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGroup>
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {[...skills, ...routines].map((item) => (
              <label key={item.id} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id)
                    )
                  }
                />
                <span>
                  {"kind" in item ? "Skill" : "Routine"}: {"name" in item ? item.name : ""}
                </span>
              </label>
            ))}
            {skills.length + routines.length === 0 && (
              <p className="text-sm text-muted-foreground">The profile can be copied on its own.</p>
            )}
          </div>
          <Button disabled={busy || !botId} onClick={() => void prepare()}>
            {busy ? "Preparing…" : "Review and copy"}
          </Button>
          <p className="text-xs text-muted-foreground">
            History, memory, files, connections, and permission grants stay with the original
            teammate.
          </p>
        </section>
        <section className="space-y-4 rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">Import a template</h2>
          <p className="text-sm text-muted-foreground">
            Choose an HQBot template file. Review its instructions before creating a teammate.
          </p>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="template-file">Template file</FieldLabel>
              <Input
                id="template-file"
                type="file"
                accept="application/json,.json"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  try {
                    if (file.size > 80000) throw new Error("Choose a template smaller than 80 KB");
                    setReview({
                      template: parseTemplate(JSON.parse(await file.text())),
                      own: false
                    });
                    setError("");
                  } catch (cause) {
                    setError(errorMessage(cause, "This is not a valid HQBot template"));
                  }
                }}
              />
            </Field>
          </FieldGroup>
        </section>
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">Public links</h2>
        {shares.length === 0 ? (
          <p className="text-sm text-muted-foreground">No public templates shared.</p>
        ) : (
          shares.map((share) => (
            <article
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
              key={share.id}
            >
              <div>
                <p className="font-medium">{share.name}</p>
                <a
                  className="text-xs text-muted-foreground underline"
                  href={`/api/public/templates/${share.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open shared template
                </a>
              </div>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await api(`/api/templates/shares/${share.id}`, { method: "DELETE" });
                    await loadShares();
                  } catch (cause) {
                    setError(errorMessage(cause, "The link could not be revoked"));
                  }
                }}
              >
                Revoke link
              </Button>
            </article>
          ))
        )}
      </section>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {review && (
        <TemplateReview
          template={review.template}
          canPublish={review.own}
          onClose={() => setReview(null)}
          onShared={() => void loadShares()}
          onImported={(bot) => {
            void controller.load(bot.id);
            controller.selectBot(bot);
            onConversation();
          }}
        />
      )}
    </section>
  );
}
