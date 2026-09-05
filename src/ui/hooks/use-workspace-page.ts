import { useCallback, useEffect, useState } from "react";

const pages = [
  "chat",
  "library",
  "projects",
  "automations",
  "inbox",
  "search",
  "templates",
  "settings"
] as const;
export type WorkspacePage =
  | "chat"
  | "library"
  | "projects"
  | "automations"
  | "inbox"
  | "search"
  | "templates"
  | "settings";
function currentPage(): WorkspacePage {
  const value = new URL(window.location.href).searchParams.get("page");
  return pages.find((page) => page === value) ?? "chat";
}
export function useWorkspacePage(): [WorkspacePage, (next: WorkspacePage) => void] {
  const [page, update] = useState(currentPage);
  const setPage = useCallback((next: WorkspacePage) => {
    const url = new URL(window.location.href);
    if (next === "chat") url.searchParams.delete("page");
    else url.searchParams.set("page", next);
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    update(next);
  }, []);
  useEffect(() => {
    const pop = () => update(currentPage());
    const search = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPage("search");
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", search);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", search);
    };
  }, [setPage]);
  return [page, setPage];
}
