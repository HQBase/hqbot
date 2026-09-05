import { type FormEvent, useEffect, useState } from "react";
import type { Project, ProjectInput } from "../../../domain/projects";
import type { BotFile, BotSkill, BotTeammate } from "../../../domain/types";
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

export function ProjectEditor({
  project,
  bots,
  onClose,
  onSaved,
  onDeleted
}: {
  project?: Project;
  bots: BotTeammate[];
  onClose: () => void;
  onSaved: (project: Project) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [botIds, setBotIds] = useState(project?.botIds ?? []);
  const [leadBotId, setLeadBotId] = useState(project?.leadBotId ?? project?.botIds[0] ?? "");
  const selectedLead = botIds.includes(leadBotId) ? leadBotId : (botIds[0] ?? "");
  const [resources, setResources] = useState<ProjectInput["resources"]>(project?.resources ?? []);
  const [available, setAvailable] = useState<
    { kind: "file" | "skill"; id: string; botId: string; name: string }[]
  >([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [remove, setRemove] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(
      botIds.map(async (botId) => {
        const snapshot = await api<{ files: BotFile[]; skills: BotSkill[] }>(
          `/api/snapshot?botId=${botId}`,
          { signal: controller.signal }
        );
        return [
          ...snapshot.files
            .filter((item) => item.botId === botId)
            .map((item) => ({ kind: "file" as const, id: item.id, botId, name: item.name })),
          ...snapshot.skills
            .filter((item) => item.botId === botId)
            .map((item) => ({ kind: "skill" as const, id: item.id, botId, name: item.name }))
        ];
      })
    ).then(
      (items) => setAvailable(items.flat()),
      (cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause, "Resources could not load"));
      }
    );
    return () => controller.abort();
  }, [botIds]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await api<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          id: project?.id,
          revision: project?.revision,
          name,
          description,
          botIds,
          leadBotId: selectedLead,
          resources: resources.filter((item) => botIds.includes(item.botId))
        })
      });
      onSaved(result.project);
    } catch (cause) {
      setError(errorMessage(cause, "The group could not be saved"));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{project ? "Edit group" : "New group"}</DialogTitle>
          <DialogDescription>
            Give teammates a shared purpose and choose what they can share.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={(event) => void save(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <Input
                id="project-name"
                value={name}
                required
                maxLength={100}
                placeholder="Website launch"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-description">What are we working on?</FieldLabel>
              <Textarea
                id="project-description"
                value={description}
                maxLength={2000}
                placeholder="The outcome, context, and any limits."
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Teammates</FieldLabel>
              <div className="grid gap-2 sm:grid-cols-2">
                {bots.map((bot) => (
                  <label
                    key={bot.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={botIds.includes(bot.id)}
                      onChange={(event) =>
                        setBotIds(
                          event.target.checked
                            ? [...botIds, bot.id]
                            : botIds.filter((id) => id !== bot.id)
                        )
                      }
                    />
                    <span>
                      <strong className="font-medium">{bot.name}</strong>
                      <span className="block text-xs text-muted-foreground">{bot.title}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-lead">Group lead</FieldLabel>
              <select
                id="project-lead"
                value={selectedLead}
                onChange={(event) => setLeadBotId(event.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm"
                disabled={!botIds.length}
              >
                {!botIds.length && <option value="">Choose teammates first</option>}
                {bots
                  .filter((bot) => botIds.includes(bot.id))
                  .map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">
                The lead owns the final answer, assigns work, and checks each result.
              </p>
            </Field>
            <Field>
              <FieldLabel>Shared files and skills</FieldLabel>
              <p className="text-xs text-muted-foreground">
                Only selected items are shared. Each teammate keeps its own computer and logins.
              </p>
              <div className="flex max-h-52 flex-col gap-2 overflow-auto">
                {available.map((item) => (
                  <label
                    key={`${item.kind}:${item.id}`}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={resources.some(
                        (resource) => resource.id === item.id && resource.kind === item.kind
                      )}
                      onChange={(event) =>
                        setResources(
                          event.target.checked
                            ? [...resources, { kind: item.kind, id: item.id, botId: item.botId }]
                            : resources.filter(
                                (resource) => resource.id !== item.id || resource.kind !== item.kind
                              )
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{item.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.kind === "file" ? "File" : "Skill"} ·{" "}
                        {bots.find((bot) => bot.id === item.botId)?.name}
                      </span>
                    </span>
                  </label>
                ))}
                {!available.length && (
                  <p className="py-3 text-sm text-muted-foreground">
                    Choose teammates with saved files or skills to share them here.
                  </p>
                )}
              </div>
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          {remove && project && (
            <div className="flex flex-col gap-3 rounded-lg border border-destructive p-3 text-sm">
              <p>
                Delete this group and its group messages? Teammates and their files stay available.
              </p>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  try {
                    await api(`/api/projects/${project.id}`, { method: "DELETE" });
                    onDeleted();
                  } catch (cause) {
                    setError(errorMessage(cause, "The group could not be deleted"));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                Delete group and messages
              </Button>
            </div>
          )}
          <DialogFooter>
            {project && (
              <Button
                type="button"
                variant="ghost"
                className="sm:mr-auto"
                disabled={pending}
                onClick={() => setRemove(!remove)}
              >
                Delete…
              </Button>
            )}
            <Button type="button" disabled={pending} variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !botIds.length || botIds.length > 12}>
              {pending ? "Saving…" : "Save group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
