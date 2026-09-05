import { useEffect, useState } from "react";
import { PiBell, PiBookOpen, PiCalendar, PiChatCircle, PiFolder, PiList } from "react-icons/pi";

import type { BotSkill } from "../../domain/types";
import type { WorkspaceController } from "../hooks/use-workspace";
import { AutomationsPage } from "./automations/automations-page";
import { ConversationPanel } from "./conversation-panel";
import { DetailsPanel } from "./details/details-panel";
import { ConnectionDialog } from "./dialogs/connection-dialog";
import { RoutineDialog } from "./dialogs/routine-dialog";
import { SkillDialog } from "./dialogs/skill-dialog";
import { InboxPage } from "./inbox/inbox-page";
import { LibraryPage } from "./library/library-page";
import { ProjectsPage } from "./projects/projects-page";
import { TeammateSidebar } from "./teammate-sidebar";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

export function WorkspaceShell({ controller }: { controller: WorkspaceController }) {
  const [prompt, setPrompt] = useState("");
  const [page, setPage] = useState<"chat" | "library" | "projects" | "automations" | "inbox">(() =>
    new URL(location.href).searchParams.get("page") === "inbox" ? "inbox" : "chat"
  );
  const [mobileViewport, setMobileViewport] = useState(
    () => window.matchMedia("(max-width: 1023px)").matches
  );
  useEffect(() => {
    document.documentElement.dataset.hqbotShell = "fixed";
    return () => {
      delete document.documentElement.dataset.hqbotShell;
    };
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobileViewport(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const snapshot = controller.snapshot;
  if (!snapshot) return null;
  const pageContent =
    page === "inbox" ? (
      <InboxPage controller={controller} onConversation={() => setPage("chat")} />
    ) : page === "automations" ? (
      <AutomationsPage controller={controller} onConversation={() => setPage("chat")} />
    ) : page === "projects" ? (
      <ProjectsPage controller={controller} />
    ) : (
      <LibraryPage controller={controller} />
    );

  function useSkill(skill: BotSkill): void {
    setPrompt(`/${skill.name.toLowerCase().replaceAll(" ", "-")} `);
  }

  function selectBot(bot: Parameters<WorkspaceController["selectBot"]>[0]): void {
    setPage("chat");
    setPrompt("");
    controller.selectBot(bot);
  }

  function beginNewTeammate(): void {
    setPage("chat");
    setPrompt("");
    void controller.beginNewTeammate();
  }

  const sidebar = (
    <TeammateSidebar
      header={
        <nav
          aria-label="Workspace"
          className="mb-4 flex shrink-0 flex-col gap-1 border-b border-divider pb-3"
        >
          <span className="px-3 py-2 text-sm font-semibold">HQBot</span>
          <Button
            className="justify-start"
            variant={page === "inbox" ? "secondary" : "ghost"}
            onClick={() => {
              setPage("inbox");
              controller.setMobileChatOpen(true);
            }}
          >
            <PiBell /> Inbox{" "}
            {snapshot.notifications?.some((item) => !item.readAt) && (
              <span className="ml-auto rounded-md bg-primary/10 px-2 text-xs">
                {snapshot.notifications.filter((item) => !item.readAt).length}
              </span>
            )}
          </Button>
          <Button
            className="justify-start"
            variant={page === "chat" ? "secondary" : "ghost"}
            onClick={() => {
              setPage("chat");
              controller.setMobileChatOpen(true);
            }}
          >
            <PiChatCircle /> Conversations
          </Button>
          <Button
            className="justify-start"
            variant={page === "library" ? "secondary" : "ghost"}
            onClick={() => {
              setPage("library");
              controller.setMobileChatOpen(true);
            }}
          >
            <PiBookOpen /> Library
          </Button>
          <Button
            className="justify-start"
            variant={page === "projects" ? "secondary" : "ghost"}
            onClick={() => {
              setPage("projects");
              controller.setMobileChatOpen(true);
            }}
          >
            <PiFolder /> Projects
          </Button>
          <Button
            className="justify-start"
            variant={page === "automations" ? "secondary" : "ghost"}
            onClick={() => {
              setPage("automations");
              controller.setMobileChatOpen(true);
            }}
          >
            <PiCalendar /> Automations
          </Button>
        </nav>
      }
      archivedBots={snapshot.archivedBots}
      bots={snapshot.bots}
      selectedId={controller.selectedBot?.id ?? null}
      onCreate={beginNewTeammate}
      onLogout={() => void controller.logout()}
      onSelect={selectBot}
    />
  );

  return (
    <main className="relative flex h-screen h-[100dvh] touch-manipulation overflow-hidden bg-rail pt-[env(safe-area-inset-top)] text-foreground lg:p-2">
      {mobileViewport ? (
        <div className="flex h-full w-full flex-col bg-list">
          {page !== "chat" ? (
            <>
              <div className="flex shrink-0 items-center border-b px-4 py-2">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Open navigation"
                  onClick={() => controller.setMobileChatOpen(false)}
                >
                  <PiList />
                </Button>
                <span className="ml-2 text-sm font-medium">HQBot</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">{pageContent}</div>
            </>
          ) : (
            <ConversationPanel
              controller={controller}
              prompt={prompt}
              showBack
              onPromptChange={setPrompt}
            />
          )}
        </div>
      ) : (
        <div className="flex h-full w-full gap-2">
          <div className="flex h-full w-[17rem] shrink-0">{sidebar}</div>
          <div className="relative min-w-0 flex-1 overflow-hidden rounded-[24px] border border-divider bg-reader shadow-sm">
            <div className="flex h-full min-w-0">
              {page !== "chat" ? (
                <div className="min-w-0 flex-1 overflow-y-auto">{pageContent}</div>
              ) : (
                <>
                  <ConversationPanel
                    controller={controller}
                    prompt={prompt}
                    onPromptChange={setPrompt}
                  />
                  {controller.detailsOpen && (
                    <DetailsPanel controller={controller} onUseSkill={useSkill} />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {mobileViewport ? (
        <Sheet
          open={!controller.mobileChatOpen}
          onOpenChange={(open) => controller.setMobileChatOpen(!open)}
        >
          <SheetContent
            className="w-[min(92vw,20rem)] p-2 [&>button:last-child]:right-14"
            side="left"
          >
            <SheetTitle className="sr-only">Teammates</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>
      ) : null}
      {mobileViewport ? (
        <Sheet
          open={page === "chat" && controller.detailsOpen && controller.mobileChatOpen}
          onOpenChange={controller.setDetailsOpen}
        >
          <SheetContent className="w-[min(92vw,22rem)] p-0">
            <SheetTitle className="sr-only">Teammate details</SheetTitle>
            <DetailsPanel controller={controller} onUseSkill={useSkill} />
          </SheetContent>
        </Sheet>
      ) : null}
      <WorkspaceDialogs controller={controller} />
    </main>
  );
}

function WorkspaceDialogs({ controller }: { controller: WorkspaceController }) {
  const bot = controller.selectedBot;
  if (!bot) return null;
  const close = () => controller.setDialog(null);
  const changed = () => controller.load(bot.id);
  return (
    <>
      {controller.dialog === "connection" ? (
        <ConnectionDialog
          bot={bot}
          key={`connection-${bot.id}`}
          open
          onOpenChange={(open) => !open && close()}
        />
      ) : null}
      <RoutineDialog
        bot={bot}
        key={`routine-${bot.id}`}
        open={controller.dialog === "routine"}
        onChanged={changed}
        onOpenChange={(open) => !open && close()}
      />
      <SkillDialog
        bot={bot}
        key={`skill-${bot.id}`}
        open={controller.dialog === "skill"}
        onChanged={changed}
        onOpenChange={(open) => !open && close()}
      />
    </>
  );
}
