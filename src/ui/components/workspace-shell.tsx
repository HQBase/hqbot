import { useEffect, useState } from "react";
import { PiPlus, PiRobot, PiSignOut } from "react-icons/pi";

import type { BotSkill } from "../../domain/types";
import type { WorkspaceController } from "../hooks/use-workspace";
import { ConversationPanel } from "./conversation-panel";
import { DetailsPanel } from "./details/details-panel";
import { ConnectionDialog } from "./dialogs/connection-dialog";
import { ProfileDialog } from "./dialogs/profile-dialog";
import { RoutineDialog } from "./dialogs/routine-dialog";
import { SkillDialog } from "./dialogs/skill-dialog";
import { QuickRail } from "./quick-rail";
import { TeammateSidebar } from "./teammate-sidebar";
import { Button } from "./ui/button";
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

  function showDetails(section: "costs" | "routines"): void {
    controller.setDetailsOpen(true);
    window.requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView());
  }

  const sidebar = (
    <TeammateSidebar
      archivedBots={snapshot.archivedBots}
      bots={snapshot.bots}
      selectedId={controller.selectedBot?.id ?? null}
      onCreate={beginNewTeammate}
      onSelect={selectBot}
    />
  );

  return (
    <main className="relative flex h-screen h-[100dvh] touch-manipulation overflow-hidden bg-rail pt-[env(safe-area-inset-top)] text-foreground lg:p-2">
      <div className="hidden h-full w-full gap-2 lg:flex">
        <div className="flex h-full w-[20rem] shrink-0">
          <QuickRail onLogout={() => void controller.logout()} onNavigate={showDetails} />
          {sidebar}
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-[24px] border border-divider bg-reader shadow-sm">
          <div className="flex h-full min-w-0">
            <ConversationPanel controller={controller} prompt={prompt} onPromptChange={setPrompt} />
            {controller.detailsOpen ? (
              <DetailsPanel controller={controller} onUseSkill={useSkill} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex h-full w-full flex-col bg-list lg:hidden">
        {controller.mobileChatOpen ? (
          <ConversationPanel
            controller={controller}
            prompt={prompt}
            showBack
            onPromptChange={setPrompt}
          />
        ) : (
          <>
            <header className="flex h-12 shrink-0 items-center gap-3 border-b border-divider bg-toolbar px-3">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <PiRobot />
              </span>
              <strong className="text-sm">HQBot</strong>
              <div className="ml-auto flex gap-1">
                <Button
                  aria-label="New teammate"
                  className="size-11"
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={beginNewTeammate}
                >
                  <PiPlus />
                </Button>
                <Button
                  aria-label="Sign out"
                  className="size-11"
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => void controller.logout()}
                >
                  <PiSignOut />
                </Button>
              </div>
            </header>
            <div className="min-h-0 flex-1 p-2">{sidebar}</div>
          </>
        )}
      </div>

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
      <ConnectionDialog
        bot={bot}
        key={`connection-${bot.id}`}
        open={controller.dialog === "connection"}
        onChanged={changed}
        onOpenChange={(open) => !open && close()}
      />
      <ProfileDialog
        bot={bot}
        key={`profile-${bot.id}`}
        open={controller.dialog === "profile"}
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
