import { lazy, Suspense } from "react";
import type { WorkspaceController } from "../hooks/use-workspace";
import type { WorkspacePage } from "../hooks/use-workspace-page";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

const AutomationsPage = lazy(() =>
  import("./automations/automations-page").then((m) => ({ default: m.AutomationsPage }))
);
const InboxPage = lazy(() => import("./inbox/inbox-page").then((m) => ({ default: m.InboxPage })));
const LibraryPage = lazy(() =>
  import("./library/library-page").then((m) => ({ default: m.LibraryPage }))
);
const TemplatesPage = lazy(() =>
  import("./library/templates-page").then((m) => ({ default: m.TemplatesPage }))
);
const ProjectsPage = lazy(() =>
  import("./projects/projects-page").then((m) => ({ default: m.ProjectsPage }))
);
const SearchPage = lazy(() =>
  import("./search/search-page").then((m) => ({ default: m.SearchPage }))
);
const SettingsPage = lazy(() =>
  import("./settings/settings-page").then((m) => ({ default: m.SettingsPage }))
);

export function WorkspacePages({
  page,
  setPage,
  controller,
  onConversation,
  onAsk
}: {
  page: WorkspacePage;
  setPage: (page: WorkspacePage) => void;
  controller: WorkspaceController;
  onConversation: () => void;
  onAsk: (botId: string, text: string) => void;
}) {
  if (page === "chat") return null;
  return (
    <Dialog open onOpenChange={(open) => !open && setPage("chat")}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90dvh] w-[min(96vw,64rem)] overflow-y-auto p-0 pt-8 sm:max-w-5xl"
      >
        <DialogTitle className="sr-only">
          {page === "inbox" ? "Updates" : page[0].toUpperCase() + page.slice(1)}
        </DialogTitle>
        <Suspense
          fallback={
            <p role="status" className="p-6 text-sm">
              Loading…
            </p>
          }
        >
          {page === "settings" ? (
            <SettingsPage controller={controller} />
          ) : page === "templates" ? (
            <TemplatesPage
              controller={controller}
              onBack={() => setPage("chat")}
              onConversation={onConversation}
            />
          ) : page === "search" ? (
            <SearchPage controller={controller} onAsk={onAsk} />
          ) : page === "inbox" ? (
            <InboxPage controller={controller} onConversation={onConversation} />
          ) : page === "automations" ? (
            <AutomationsPage controller={controller} onConversation={onConversation} />
          ) : page === "projects" ? (
            <ProjectsPage controller={controller} />
          ) : (
            <LibraryPage controller={controller} onTemplates={() => setPage("templates")} />
          )}
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
