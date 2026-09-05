import { useEffect, useState } from "react";
import { PiUsers, PiX } from "react-icons/pi";
import type { Project } from "../../../domain/projects";
import type { BotFile, BotSkill, BotTeammate } from "../../../domain/types";
import { api, errorMessage } from "../../lib/api";
import { FilePreview } from "../chat/file-preview";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";

export function GroupInfoPanel({
  project,
  bots,
  onClose,
  onEdit,
  onSelect
}: {
  project: Project;
  bots: BotTeammate[];
  onClose: () => void;
  onEdit: () => void;
  onSelect: (bot: BotTeammate) => void;
}) {
  const [resources, setResources] = useState<{ files: BotFile[]; skills: BotSkill[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void api<{ files: BotFile[]; skills: BotSkill[] }>(`/api/projects/${project.id}/resources`, {
      signal: controller.signal
    }).then(
      (value) => {
        if (!controller.signal.aborted) setResources(value);
      },
      (cause) => {
        if (!controller.signal.aborted)
          setError(errorMessage(cause, "Shared items could not load"));
      }
    );
    return () => controller.abort();
  }, [project.id]);
  return (
    <aside
      aria-label="Group info"
      className="flex h-full w-full shrink-0 flex-col border-l border-divider bg-list lg:w-[22rem]"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-divider px-4 pr-14 lg:pr-3">
        <h2 className="text-sm font-semibold">Group info</h2>
        <Button
          aria-label="Close group info"
          className="hidden lg:inline-flex"
          size="icon"
          variant="ghost"
          onClick={onClose}
        >
          <PiX />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <div className="flex flex-col items-center gap-2 py-3 text-center">
          <Avatar className="size-16">
            <AvatarFallback>
              <PiUsers className="size-7" />
            </AvatarFallback>
          </Avatar>
          <h3 className="text-base font-semibold">{project.name}</h3>
          <p className="text-xs text-muted-foreground">{project.description}</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={onEdit}>
            Edit group
          </Button>
        </div>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Members</h3>
          {project.botIds.map((id) => {
            const bot = bots.find((item) => item.id === id);
            return (
              <Button
                key={id}
                className="justify-start"
                variant="ghost"
                disabled={!bot}
                onClick={() => bot && onSelect(bot)}
              >
                {bot?.name ?? "Archived teammate"}
              </Button>
            );
          })}
        </section>
        <section className="flex flex-col gap-3 border-t border-divider pt-4">
          <h3 className="text-sm font-medium">Shared files and skills</h3>
          <p className="text-xs text-muted-foreground">
            Only items selected for this group are shared. Computers and integrations stay with each
            teammate.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : !resources ? (
            <p role="status" className="text-sm">
              Loading shared items…
            </p>
          ) : (
            <>
              {resources.files.map((file) => (
                <FilePreview key={file.id} file={file} />
              ))}
              {resources.skills.map((skill) => (
                <div key={skill.id} className="rounded-lg border p-3">
                  <h4 className="text-sm font-medium">{skill.name}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                </div>
              ))}
              {!resources.files.length && !resources.skills.length && (
                <p className="text-sm text-muted-foreground">No shared items yet.</p>
              )}
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
