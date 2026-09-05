import { type FormEvent, useEffect, useState } from "react";
import type { KnowledgeItem, KnowledgeVersion } from "../../../domain/knowledge";
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

export function KnowledgeEditor({
  botId,
  kind,
  item,
  onClose,
  onSaved
}: {
  botId: string;
  kind: "memory" | "skill";
  item?: KnowledgeItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(item?.kind === "skill" ? item.name : "");
  const [description, setDescription] = useState(item?.kind === "skill" ? item.description : "");
  const [content, setContent] = useState(
    item?.kind === "skill" ? item.instructions : (item?.content ?? "")
  );
  const [status, setStatus] = useState(item?.status ?? "draft");
  const [versions, setVersions] = useState<KnowledgeVersion[]>([]);
  const [pending, setPending] = useState(false);
  const [forget, setForget] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    void api<{ versions: KnowledgeVersion[] }>(
      `/api/bots/${botId}/knowledge?history=${encodeURIComponent(item.id)}`,
      { signal: controller.signal }
    ).then(
      (result) => setVersions(result.versions),
      (cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause, "History could not load"));
      }
    );
    return () => controller.abort();
  }, [botId, item]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api(`/api/bots/${botId}/knowledge`, {
        method: "POST",
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          entry: {
            kind,
            id: item?.id,
            revision: item?.revision,
            source: "Saved by owner",
            ...(kind === "memory"
              ? { content, category: item?.category ?? "preference" }
              : { name, description, instructions: content, status })
          }
        })
      });
      await onSaved();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, "The entry could not be saved"));
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    if (!item) return;
    setPending(true);
    setError("");
    try {
      await api(`/api/bots/${botId}/knowledge`, {
        method: "DELETE",
        body: JSON.stringify({ id: item.id, kind })
      });
      await onSaved();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, "The entry could not be forgotten"));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {item ? "Edit" : "New"} {kind}
          </DialogTitle>
          <DialogDescription>
            {kind === "memory"
              ? "Keep a useful fact or preference for this teammate."
              : "Save a method. Keep it as a draft until its steps have been tested."}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={(event) => void save(event)}>
          <FieldGroup>
            {kind === "skill" && (
              <>
                <Field>
                  <FieldLabel htmlFor="knowledge-name">Name</FieldLabel>
                  <Input
                    id="knowledge-name"
                    required
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="knowledge-description">What does it do?</FieldLabel>
                  <Input
                    id="knowledge-description"
                    required
                    maxLength={300}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
              </>
            )}
            <Field>
              <FieldLabel htmlFor="knowledge-content">
                {kind === "skill" ? "Steps and checks" : "What should the teammate remember?"}
              </FieldLabel>
              <Textarea
                className="min-h-36"
                id="knowledge-content"
                required
                maxLength={kind === "skill" ? 12000 : 1500}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </Field>
            {kind === "skill" && (
              <Field>
                <FieldLabel htmlFor="knowledge-ready">Status</FieldLabel>
                <select
                  id="knowledge-ready"
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value === "ready" ? "ready" : "draft")
                  }
                >
                  <option value="draft">Draft — needs a test</option>
                  <option value="ready">Ready — tested</option>
                </select>
              </Field>
            )}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          {item && (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer">Revision history ({versions.length})</summary>
              <div className="mt-3 flex flex-col gap-3">
                {versions.map((version) => (
                  <div key={version.revision} className="flex flex-col gap-1 border-t pt-2">
                    <p className="font-medium">
                      Revision {version.revision} · {new Date(version.createdAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">{version.item.source}</p>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-sans text-xs">
                      {version.item.kind === "memory"
                        ? version.item.content
                        : version.item.instructions}
                    </pre>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      className="self-start"
                      onClick={() => {
                        setContent(
                          version.item.kind === "memory"
                            ? version.item.content
                            : version.item.instructions
                        );
                        if (version.item.kind === "skill") {
                          setName(version.item.name);
                          setDescription(version.item.description);
                          setStatus("draft");
                        }
                      }}
                    >
                      Use this version in editor
                    </Button>
                  </div>
                ))}
              </div>
            </details>
          )}
          {forget && (
            <div className="rounded-lg border border-destructive p-3 text-sm">
              <p>
                Forget this entry and all its saved revisions? Earlier chat messages stay in the
                conversation.
              </p>
              <Button
                className="mt-2"
                disabled={pending}
                type="button"
                variant="destructive"
                onClick={() => void remove()}
              >
                Forget entry and history
              </Button>
            </div>
          )}
          <DialogFooter>
            {item && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                className="sm:mr-auto"
                onClick={() => setForget(!forget)}
              >
                Forget…
              </Button>
            )}
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
