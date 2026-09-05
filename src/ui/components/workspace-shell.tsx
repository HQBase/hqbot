import { lazy, Suspense, useEffect, useState } from "react";
import { PiBell, PiGear } from "react-icons/pi";
import type { Project } from "../../domain/projects";
import type { BotSkill, BotTeammate } from "../../domain/types";
import { useConversationGroups } from "../hooks/use-conversation-groups";
import type { WorkspaceController } from "../hooks/use-workspace";
import { useWorkspacePage } from "../hooks/use-workspace-page";
import { ConversationPanel } from "./conversation-panel";
import { DetailsPanel } from "./details/details-panel";
import { ConnectionDialog } from "./dialogs/connection-dialog";
import { NewConversationDialog } from "./dialogs/new-conversation-dialog";
import { RoutineDialog } from "./dialogs/routine-dialog";
import { SkillDialog } from "./dialogs/skill-dialog";
import { ProjectEditor } from "./projects/project-editor";
import { TeammateSidebar } from "./teammate-sidebar";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { WorkspacePages } from "./workspace-pages";

const GroupThread = lazy(() =>
  import("./projects/group-thread").then((m) => ({ default: m.GroupThread }))
);
const GroupInfoPanel = lazy(() =>
  import("./projects/group-info-panel").then((m) => ({ default: m.GroupInfoPanel }))
);

export function WorkspaceShell({ controller }: { controller: WorkspaceController }) {
  const [prompt, setPrompt] = useState("");
  const [page, setPage] = useWorkspacePage();
  const groups = useConversationGroups();
  const [newConversation, setNewConversation] = useState(false);
  const [groupEditor, setGroupEditor] = useState<Project | "new" | null>(null);
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
  const unread = snapshot.notifications?.filter((item) => !item.readAt).length ?? 0;
  function selectBot(bot: BotTeammate) {
    groups.select(null);
    setPage("chat");
    setPrompt("");
    controller.selectBot(bot);
  }
  function selectGroup(project: Project) {
    groups.select(project.id);
    setPage("chat");
    controller.setDetailsOpen(false);
    controller.setMobileChatOpen(true);
  }
  function openConversation() {
    groups.select(null);
    setPage("chat");
    controller.setDetailsOpen(false);
    controller.setMobileChatOpen(true);
  }
  function useSkill(skill: BotSkill) {
    setPrompt(`/${skill.name.toLowerCase().replaceAll(" ", "-")} `);
    controller.setDetailsOpen(false);
  }
  const sidebar = (
    <TeammateSidebar
      archivedBots={snapshot.archivedBots}
      bots={snapshot.bots}
      selectedId={groups.selectedId ? null : (controller.selectedBot?.id ?? null)}
      projects={groups.projects}
      selectedProjectId={groups.selectedId}
      onSelectProject={selectGroup}
      onSelect={selectBot}
      onCreate={() => setNewConversation(true)}
      onSearch={() => setPage("search")}
      onLogout={() => void controller.logout()}
      footer={
        <>
          {groups.error && (
            <div role="alert" className="px-3 py-2 text-xs text-destructive">
              {groups.error}
              <Button size="sm" variant="link" onClick={() => void groups.load()}>
                Retry
              </Button>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-divider px-1 pt-2">
            <Button
              aria-label="Settings"
              size="icon"
              variant="ghost"
              onClick={() => setPage("settings")}
            >
              <PiGear />
            </Button>
            <Button
              aria-label={unread ? `Updates, ${unread} unread` : "Updates"}
              size="sm"
              variant="ghost"
              onClick={() => setPage("inbox")}
            >
              <PiBell data-icon="inline-start" />
              {unread ? (
                <span className="tabular-nums">{unread}</span>
              ) : (
                <span className="sr-only">Updates</span>
              )}
            </Button>
          </div>
        </>
      }
    />
  );
  const conversation = groups.selected ? (
    <GroupThread
      key={groups.selected.id}
      project={groups.selected}
      bots={snapshot.bots}
      showBack={mobileViewport}
      onBack={() => controller.setMobileChatOpen(false)}
      onInfo={() => controller.openDetails()}
    />
  ) : groups.selectedId ? (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground"
    >
      <p>{groups.error || "This group is loading or is no longer available."}</p>
      <Button
        variant="outline"
        onClick={() => {
          groups.select(null);
          controller.setMobileChatOpen(false);
        }}
      >
        Back to conversations
      </Button>
    </div>
  ) : (
    <ConversationPanel
      controller={controller}
      prompt={prompt}
      showBack={mobileViewport}
      onPromptChange={setPrompt}
    />
  );
  const info = groups.selected ? (
    <GroupInfoPanel
      key={`${groups.selected.id}:${groups.selected.revision}`}
      project={groups.selected}
      bots={snapshot.bots}
      onClose={() => controller.setDetailsOpen(false)}
      onEdit={() => setGroupEditor(groups.selected)}
      onSelect={selectBot}
    />
  ) : (
    <DetailsPanel
      key={`${controller.selectedBot?.id}:${controller.detailsView}`}
      controller={controller}
      onUseSkill={useSkill}
    />
  );
  return (
    <main className="relative flex h-screen h-[100dvh] touch-manipulation overflow-hidden bg-rail pt-[env(safe-area-inset-top)] text-foreground lg:p-2">
      <div className="flex h-full w-full gap-2">
        {(!mobileViewport || !controller.mobileChatOpen) && (
          <div className="flex h-full w-full shrink-0 lg:w-[18rem]">{sidebar}</div>
        )}
        {(!mobileViewport || controller.mobileChatOpen) && (
          <div className="relative min-w-0 flex-1 overflow-hidden border-divider bg-reader lg:rounded-[24px] lg:border lg:shadow-sm">
            <div className="flex h-full min-w-0">
              <Suspense
                fallback={
                  <p role="status" className="p-6 text-sm">
                    Loading conversation…
                  </p>
                }
              >
                {conversation}
                {!mobileViewport && controller.detailsOpen && info}
              </Suspense>
            </div>
          </div>
        )}
      </div>
      {mobileViewport && (
        <Sheet
          open={controller.detailsOpen && controller.mobileChatOpen}
          onOpenChange={controller.setDetailsOpen}
        >
          <SheetContent className="w-[min(96vw,24rem)] p-0" aria-describedby={undefined}>
            <SheetTitle className="sr-only">
              {groups.selected
                ? "Group info"
                : controller.detailsView === "computer"
                  ? "Computer"
                  : "Conversation info"}
            </SheetTitle>
            <Suspense
              fallback={
                <p role="status" className="p-6 text-sm">
                  Loading…
                </p>
              }
            >
              {info}
            </Suspense>
          </SheetContent>
        </Sheet>
      )}
      <WorkspacePages
        page={page}
        setPage={setPage}
        controller={controller}
        onConversation={openConversation}
        onAsk={(botId, text) => {
          const bot = snapshot.bots.find((item) => item.id === botId);
          if (bot) selectBot(bot);
          setPrompt(text);
          setPage("chat");
        }}
      />
      {newConversation && (
        <NewConversationDialog
          canGroup={snapshot.bots.length > 0}
          onClose={() => setNewConversation(false)}
          onTeammate={() => {
            setNewConversation(false);
            openConversation();
            setPrompt("");
            void controller.beginNewTeammate();
          }}
          onGroup={() => {
            setNewConversation(false);
            setGroupEditor("new");
          }}
          onTemplate={() => {
            setNewConversation(false);
            setPage("templates");
          }}
        />
      )}
      {groupEditor && (
        <ProjectEditor
          key={groupEditor === "new" ? "new" : groupEditor.id}
          project={groupEditor === "new" ? undefined : groupEditor}
          bots={snapshot.bots}
          onClose={() => setGroupEditor(null)}
          onSaved={(project) => {
            groups.saved(project);
            setGroupEditor(null);
            controller.setDetailsOpen(false);
            controller.setMobileChatOpen(true);
            setPage("chat");
          }}
          onDeleted={() => {
            groups.removed();
            setGroupEditor(null);
            controller.setDetailsOpen(false);
          }}
        />
      )}
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
      {controller.dialog === "connection" && (
        <ConnectionDialog
          bot={bot}
          key={`connection-${bot.id}`}
          open
          onOpenChange={(open) => !open && close()}
        />
      )}
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
