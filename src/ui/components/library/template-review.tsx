import { useRef, useState } from "react";
import type { TeammateTemplate } from "../../../domain/templates";
import type { BotTeammate } from "../../../domain/types";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";

export function downloadTemplate(template: TeammateTemplate) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(template, null, 2)], { type: "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "hqbot-template.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function TemplateReview({
  template,
  canPublish,
  onClose,
  onImported,
  onShared
}: {
  template: TeammateTemplate;
  canPublish: boolean;
  onClose: () => void;
  onImported: (bot: BotTeammate) => void;
  onShared: () => void;
}) {
  const [name, setName] = useState(template.profile.name);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const command = useRef({ fingerprint: "", id: crypto.randomUUID() });
  const candidate = { ...template, profile: { ...template.profile, name } };
  async function save(action: "import" | "publish") {
    setBusy(action);
    setError("");
    const fingerprint = JSON.stringify({ action, candidate });
    if (command.current.fingerprint !== fingerprint)
      command.current = { fingerprint, id: crypto.randomUUID() };
    try {
      if (action === "import") {
        const result = await api<{ teammate: BotTeammate }>("/api/templates/import", {
          method: "POST",
          body: JSON.stringify({ id: command.current.id, template: candidate })
        });
        onImported(result.teammate);
        onClose();
      } else {
        const result = await api<{ share: { id: string } }>("/api/templates/publish", {
          method: "POST",
          body: JSON.stringify({ id: command.current.id, template: candidate })
        });
        setUrl(`${location.origin}/api/public/templates/${result.share.id}`);
        onShared();
      }
    } catch (cause) {
      setError(errorMessage(cause, "The template could not be saved"));
    } finally {
      setBusy("");
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>Review template</DialogTitle>
        <DialogDescription>
          Skills start as drafts. Routines start paused. Review the full instructions for private
          information before sharing.
        </DialogDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="template-name">Teammate name</FieldLabel>
            <Input
              id="template-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <p className="text-sm text-muted-foreground">
          {candidate.skills.length} skills · {candidate.routines.length} routines · $
          {candidate.profile.dailyBudgetUsd}/day
        </p>
        <details className="rounded-xl border p-3" open>
          <summary className="cursor-pointer text-sm font-medium">Profile and instructions</summary>
          <div className="mt-3 max-h-72 space-y-4 overflow-y-auto whitespace-pre-wrap break-words text-sm">
            <p>{candidate.profile.brief}</p>
            {candidate.skills.map((skill) => (
              <section key={skill.name}>
                <h3 className="font-semibold">Skill: {skill.name}</h3>
                <p>{skill.description}</p>
                <p className="mt-2">{skill.instructions}</p>
              </section>
            ))}
            {candidate.routines.map((routine) => (
              <section key={routine.name}>
                <h3 className="font-semibold">Routine: {routine.name}</h3>
                <p>{routine.prompt}</p>
              </section>
            ))}
          </div>
        </details>
        <details className="text-xs">
          <summary className="cursor-pointer">Complete template</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(candidate, null, 2)}
          </pre>
        </details>
        {url && (
          <div className="space-y-2 rounded-xl bg-muted p-3">
            <p className="text-sm font-medium">Public link created</p>
            <Input readOnly aria-label="Public template link" value={url} />
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(url)
                  .catch(() => setError("Select and copy the link above."))
              }
            >
              Copy link
            </Button>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can download this template. Revoke it from Templates. Downloaded
              copies cannot be recalled.
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={Boolean(busy) || !name.trim()}
            onClick={() => downloadTemplate(candidate)}
          >
            Download
          </Button>
          {canPublish && !url && (
            <Button
              variant="outline"
              disabled={Boolean(busy) || !name.trim()}
              onClick={() => void save("publish")}
            >
              {busy === "publish" ? "Publishing…" : "Publish public link"}
            </Button>
          )}
          <Button disabled={Boolean(busy) || !name.trim()} onClick={() => void save("import")}>
            {busy === "import" ? "Creating…" : "Create teammate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
