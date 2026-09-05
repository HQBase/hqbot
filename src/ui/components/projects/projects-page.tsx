import { useEffect, useState } from "react";
import { PiArrowLeft, PiFolder, PiPlus } from "react-icons/pi";
import type { Project } from "../../../domain/projects";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { GroupConversation } from "./group-conversation";
import { ProjectEditor } from "./project-editor";

export function ProjectsPage({ controller }: { controller: WorkspaceController }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<Project | "new" | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ projects: Project[] }>("/api/projects", { signal: controller.signal }).then(
      (result) => {
        setProjects(result.projects);
        setLoading(false);
      },
      (cause) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(cause, "Projects could not load"));
          setLoading(false);
        }
      }
    );
    return () => controller.abort();
  }, []);
  const project = projects.find((item) => item.id === selected);
  const bots = controller.snapshot?.bots ?? [];
  return (
    <section className="flex h-full min-h-0 flex-col">
      {project ? (
        <>
          <header className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
            <Button
              size="icon"
              variant="ghost"
              aria-label="All projects"
              onClick={() => setSelected(null)}
            >
              <PiArrowLeft />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold">{project.name}</h1>
              <p className="text-xs text-muted-foreground">
                {project.botIds.length} teammates · {project.resources.length} shared items
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditor(project)}>
              Project settings
            </Button>
          </header>
          <GroupConversation key={project.id} project={project} bots={bots} />
        </>
      ) : (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-7 overflow-auto px-5 py-8 sm:px-10">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                A shared place for the goal, the team, and the work.
              </p>
            </div>
            <Button onClick={() => setEditor("new")} disabled={!bots.length}>
              <PiPlus /> New project
            </Button>
          </header>
          {loading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading projects…
            </p>
          ) : !projects.length ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
              <PiFolder className="size-8 text-muted-foreground" />
              <h2 className="font-medium">Give the team a place to work</h2>
              <p className="max-w-md px-5 text-sm text-muted-foreground">
                Create a project, choose teammates, and share the files and skills they need.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {projects.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setSelected(item.id)}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-5 text-left hover:bg-accent"
                >
                  <PiFolder className="size-6 text-muted-foreground" />
                  <h2 className="font-medium">{item.name}</h2>
                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {item.description || "Open the project conversation."}
                  </p>
                  <p className="mt-auto pt-3 text-xs text-muted-foreground">
                    {item.botIds
                      .map((id) => bots.find((bot) => bot.id === id)?.name ?? "Archived teammate")
                      .join(", ")}
                  </p>
                </button>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
      {editor && (
        <ProjectEditor
          key={editor === "new" ? "new" : editor.id}
          project={editor === "new" ? undefined : editor}
          bots={bots}
          onClose={() => setEditor(null)}
          onDeleted={() => {
            setProjects((items) => items.filter((item) => item.id !== selected));
            setSelected(null);
            setEditor(null);
          }}
          onSaved={(saved) => {
            setProjects((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
            setSelected(saved.id);
            setEditor(null);
          }}
        />
      )}
    </section>
  );
}
