import { PiInfo, PiSidebarSimple } from "react-icons/pi";
import type { Project } from "../../../domain/projects";
import type { BotTeammate } from "../../../domain/types";
import { Button } from "../ui/button";
import { GroupConversation } from "./group-conversation";

export function GroupThread({
  project,
  bots,
  onInfo,
  onBack,
  showBack
}: {
  project: Project;
  bots: BotTeammate[];
  onInfo: () => void;
  onBack: () => void;
  showBack: boolean;
}) {
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-reader">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-divider bg-toolbar px-3">
        {showBack && (
          <Button aria-label="Open conversations" size="icon" variant="ghost" onClick={onBack}>
            <PiSidebarSimple />
          </Button>
        )}
        <h1 className="min-w-0 flex-1">
          <Button
            aria-label={`About ${project.name}`}
            className="max-w-full justify-start"
            variant="ghost"
            onClick={onInfo}
          >
            <span className="truncate">{project.name}</span>
          </Button>
        </h1>
        <Button aria-label="Group info" size="icon" variant="ghost" onClick={onInfo}>
          <PiInfo />
        </Button>
      </header>
      <GroupConversation key={project.id} project={project} bots={bots} />
    </section>
  );
}
