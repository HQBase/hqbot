import { lazy, Suspense, useState } from "react";
import {
  PiArrowLeft,
  PiBrain,
  PiCalendar,
  PiCaretRight,
  PiDesktopTower,
  PiFile,
  PiPlugsConnected,
  PiSparkle,
  PiX
} from "react-icons/pi";
import type { BotSkill } from "../../../domain/types";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { initials } from "../../lib/format";
import { FilePreview } from "../chat/file-preview";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { ActionHistoryPanel } from "./action-history-panel";
import { AgentSettingsPanel } from "./agent-settings-panel";
import { BackupsPanel } from "./backups-panel";
import { ComputerPermissionsPanel } from "./computer-permissions-panel";
import { CostPanel } from "./cost-panel";
import { DesktopView } from "./desktop-view";
import { TaskProgressPanel } from "./task-progress-panel";

const LibraryPage = lazy(() =>
  import("../library/library-page").then((m) => ({ default: m.LibraryPage }))
);
const AutomationsPage = lazy(() =>
  import("../automations/automations-page").then((m) => ({ default: m.AutomationsPage }))
);
const ConnectionDialog = lazy(() =>
  import("../dialogs/connection-dialog").then((m) => ({ default: m.ConnectionDialog }))
);
const sections = [
  { id: "files", label: "Files", icon: PiFile },
  { id: "connections", label: "Integrations", icon: PiPlugsConnected },
  { id: "memory", label: "Memory", icon: PiBrain },
  { id: "skill", label: "Skills", icon: PiSparkle },
  { id: "routines", label: "Routines", icon: PiCalendar }
] as const;
type InfoSection = "info" | (typeof sections)[number]["id"];

export function DetailsPanel({
  controller,
  onUseSkill
}: {
  controller: WorkspaceController;
  onUseSkill: (skill: BotSkill) => void;
}) {
  const [section, setSection] = useState<InfoSection>("info");
  const { selectedBot: bot, snapshot } = controller;
  if (!bot || !snapshot) return null;
  const computer = controller.detailsView === "computer";
  const title = computer
    ? "Computer"
    : (sections.find((item) => item.id === section)?.label ?? "Conversation info");
  const back = () => {
    setSection("info");
    controller.setDetailsView("info");
  };
  return (
    <aside
      aria-label={title}
      className="flex h-full w-full min-w-0 shrink-0 flex-col border-l border-divider bg-list lg:w-[22rem]"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-divider px-3 pr-14 lg:pr-3">
        {(computer || section !== "info") && (
          <Button aria-label="Back to conversation info" size="icon" variant="ghost" onClick={back}>
            <PiArrowLeft />
          </Button>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        <Button
          aria-label="Close conversation info"
          className="hidden lg:inline-flex"
          size="icon"
          variant="ghost"
          onClick={() => controller.setDetailsOpen(false)}
        >
          <PiX />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <Suspense
          fallback={
            <p role="status" className="py-6 text-sm text-muted-foreground">
              Loading…
            </p>
          }
        >
          {computer ? (
            <>
              <DesktopView key={bot.id} active={bot.status === "working"} botId={bot.id} />
              <BackupsPanel botId={bot.id} />
            </>
          ) : section === "connections" ? (
            <div className="py-4">
              <ConnectionDialog
                key={bot.id}
                bot={bot}
                open
                embedded
                onOpenChange={() => setSection("info")}
              />
            </div>
          ) : section === "memory" || section === "skill" ? (
            <div className="py-4">
              <LibraryPage
                key={`${bot.id}:${section}`}
                controller={controller}
                scope={{ botId: bot.id, kind: section }}
                onUseSkill={onUseSkill}
              />
            </div>
          ) : section === "routines" ? (
            <div className="py-4">
              <AutomationsPage
                key={bot.id}
                controller={controller}
                scopeBotId={bot.id}
                onConversation={() => controller.setDetailsOpen(false)}
              />
            </div>
          ) : section === "files" ? (
            <div className="flex flex-col gap-3 py-4">
              <p className="text-xs text-muted-foreground">
                Files in your conversation with {bot.name}.
              </p>
              {snapshot.selectedBot?.id !== bot.id ? (
                <p role="status">Loading files…</p>
              ) : snapshot.files.length ? (
                snapshot.files.map((file) => <FilePreview key={file.id} file={file} />)
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Attach a file in the conversation to keep it here.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Avatar className="size-16">
                  <AvatarFallback className="text-xl">{initials(bot.name)}</AvatarFallback>
                </Avatar>
                <h3 className="mt-1 text-base font-semibold">{bot.name}</h3>
                {bot.title && <p className="text-xs text-muted-foreground">{bot.title}</p>}
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => controller.openDetails("computer")}
                >
                  <PiDesktopTower data-icon="inline-start" /> Open computer
                </Button>
              </div>
              <nav
                aria-label="Conversation resources"
                className="flex flex-col border-y border-divider py-2"
              >
                {sections.map(({ id, label, icon: Icon }) => (
                  <Button
                    key={id}
                    variant="ghost"
                    className="h-11 justify-start"
                    onClick={() => setSection(id)}
                  >
                    <Icon data-icon="inline-start" />
                    {label}
                    <PiCaretRight className="ml-auto" data-icon="inline-end" />
                  </Button>
                ))}
              </nav>
              <ComputerPermissionsPanel
                botId={bot.id}
                needsApproval={bot.status === "needs_approval"}
              />
              <AgentSettingsPanel
                bot={bot}
                onDeleted={controller.deleteSelectedBot}
                onMaxStepsChange={controller.setMaxSteps}
                onModelChange={controller.setModel}
                onSaved={controller.load}
              />
              <TaskProgressPanel botId={bot.id} revision={snapshot.activeTask?.updatedAt} />
              <ActionHistoryPanel botId={bot.id} />
              <CostPanel budgetUsd={bot.dailyBudgetUsd} costs={snapshot.costs} />
            </>
          )}
        </Suspense>
      </div>
    </aside>
  );
}
