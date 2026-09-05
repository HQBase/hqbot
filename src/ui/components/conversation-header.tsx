import { PiDesktopTower, PiInfo, PiSidebarSimple, PiStop } from "react-icons/pi";

import type { BotTeammate } from "../../domain/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function ConversationHeader({
  bot,
  showBack,
  status,
  working,
  onBack,
  onDetails,
  onComputer,
  onStop
}: {
  bot: BotTeammate | null;
  showBack: boolean;
  status: string;
  working: boolean;
  onBack: () => void;
  onDetails: () => void;
  onComputer: () => void;
  onStop: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-divider bg-toolbar px-3 lg:px-4">
      {showBack ? (
        <Button
          aria-label="Open conversations"
          className="size-11 shrink-0 text-muted-foreground lg:hidden"
          size="icon"
          type="button"
          variant="ghost"
          onClick={onBack}
        >
          <PiSidebarSimple />
        </Button>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
        <Button
          disabled={!bot}
          variant="ghost"
          className="max-w-full justify-start px-2"
          onClick={onDetails}
          aria-label={bot ? `About ${bot.name}` : undefined}
        >
          <span className="truncate">{bot?.name ?? "New teammate"}</span>
        </Button>
      </h1>
      <Badge className="hidden sm:inline-flex" variant="outline">
        {status}
      </Badge>
      {working ? (
        <Button
          aria-label="Stop teammate activity"
          size="icon"
          type="button"
          variant="ghost"
          onClick={onStop}
        >
          <PiStop />
        </Button>
      ) : null}
      <Button
        aria-label="Open computer"
        disabled={!bot}
        size="sm"
        type="button"
        variant="ghost"
        onClick={onComputer}
      >
        <PiDesktopTower data-icon="inline-start" />
        Computer
      </Button>
      <Button
        aria-label="Conversation info"
        disabled={!bot}
        size="icon"
        variant="ghost"
        onClick={onDetails}
      >
        <PiInfo />
      </Button>
    </header>
  );
}
