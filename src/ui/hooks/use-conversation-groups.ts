import { useCallback, useEffect, useState } from "react";
import type { Project } from "../../domain/projects";
import { api, errorMessage } from "../lib/api";

export function useConversationGroups() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, updateSelectedId] = useState<string | null>(() =>
    new URL(window.location.href).searchParams.get("projectId")
  );
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await api<{ projects: Project[] }>("/api/projects", { signal });
      if (!signal?.aborted) {
        setProjects(result.projects);
        setError("");
      }
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause, "Group conversations could not load"));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 30000);
    const pop = () => updateSelectedId(new URL(window.location.href).searchParams.get("projectId"));
    window.addEventListener("popstate", pop);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("popstate", pop);
    };
  }, [load]);
  const select = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("projectId", id);
    else url.searchParams.delete("projectId");
    window.history.replaceState(null, "", url);
    updateSelectedId(id);
  };
  return {
    projects,
    selectedId,
    selected: projects.find((project) => project.id === selectedId) ?? null,
    select,
    load,
    error,
    saved: (project: Project) => {
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      select(project.id);
    },
    removed: () => {
      setProjects((current) => current.filter((item) => item.id !== selectedId));
      select(null);
    }
  };
}
