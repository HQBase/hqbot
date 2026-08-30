import { useEffect, useState } from "react";

import type { BotSkill } from "../../domain/types";
import type { WorkspaceController } from "../hooks/use-workspace";
import { ConversationPanel } from "./conversation-panel";
import { DetailsPanel } from "./details/details-panel";
import { ConnectionDialog } from "./dialogs/connection-dialog";
import { ProfileDialog } from "./dialogs/profile-dialog";
import { RoutineDialog } from "./dialogs/routine-dialog";
import { SkillDialog } from "./dialogs/skill-dialog";
import { TeammateSidebar } from "./teammate-sidebar";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

export function WorkspaceShell({ controller }: { controller: WorkspaceController }) {
  const [prompt, setPrompt] = useState("");
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

  function useSkill(skill: BotSkill): void {
    setPrompt(`/${skill.name.toLowerCase().replaceAll(" ", "-")} `);
  }

  function selectBot(bot: Parameters<WorkspaceController["selectBot"]>[0]): void {
    setPrompt("");
    controller.selectBot(bot);
  }

  function beginNewTeammate(): void {
    setPrompt("");
    controller.beginNewTeammate();
  }

  const sidebar = (
    <TeammateSidebar
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
      <div className="hidden h-full w-full gap-2 lg:flex">
        <div className="flex h-full w-[17rem] shrink-0">{sidebar}</div>
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-[24px] border border-divider bg-reader shadow-sm">
          <div className="flex h-full min-w-0">
            <ConversationPanel controller={controller} prompt={prompt} onPromptChange={setPrompt} />
            <DetailsPanel controller={controller} onUseSkill={useSkill} />
          </div>
        </div>
      </div>

      <div className="flex h-full w-full flex-col bg-list lg:hidden">
        <ConversationPanel
          controller={controller}
          prompt={prompt}
          showBack
          onPromptChange={setPrompt}
        />
      </div>

      <Sheet
        open={mobileViewport && !controller.mobileChatOpen}
        onOpenChange={(open) => controller.setMobileChatOpen(!open)}
      >
        <SheetContent
          className="w-[min(92vw,20rem)] p-2 [&>button:last-child]:right-14 lg:hidden"
          side="left"
        >
          <SheetTitle className="sr-only">Teammates</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <Sheet
        open={mobileViewport && controller.detailsOpen && controller.mobileChatOpen}
        onOpenChange={controller.setDetailsOpen}
      >
        <SheetContent className="w-[min(92vw,22rem)] p-0 lg:hidden">
          <SheetTitle className="sr-only">Teammate details</SheetTitle>
          <DetailsPanel controller={controller} onUseSkill={useSkill} />
        </SheetContent>
      </Sheet>
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
      <ProfileDialog
        bot={bot}
        key={`profile-${bot.id}`}
        open={controller.dialog === "profile"}
        onDeleted={() => controller.deleteSelectedBot()}
        onOpenChange={(open) => !open && close()}
        onSaved={async (botId) => controller.load(botId)}
      />
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
