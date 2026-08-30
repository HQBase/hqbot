import { PiPencil, PiSidebarSimple, PiStop } from "react-icons/pi";

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
  onEdit,
  onStop
}: {
  bot: BotTeammate | null;
  showBack: boolean;
  status: string;
  working: boolean;
  onBack: () => void;
  onDetails: () => void;
  onEdit: () => void;
  onStop: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-divider bg-toolbar px-3 lg:px-4">
      {showBack ? (
        <Button
          aria-label="Open teammates sidebar"
          className="size-11 shrink-0 text-muted-foreground lg:hidden"
          size="icon"
          type="button"
          variant="ghost"
          onClick={onBack}
        >
          <PiSidebarSimple />
        </Button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">{bot?.name ?? "New teammate"}</h1>
        <p className="truncate text-[11px] text-muted-foreground">
          {bot?.title ?? "Start a conversation"}
        </p>
      </div>
      <Badge className="hidden sm:inline-flex" variant="outline">
        {status}
      </Badge>
      {working ? (
        <Button aria-label="Stop task" size="icon" type="button" variant="ghost" onClick={onStop}>
          <PiStop />
        </Button>
      ) : null}
      {bot ? (
        <Button
          aria-label="Edit teammate"
          size="icon"
          type="button"
          variant="ghost"
          onClick={onEdit}
        >
          <PiPencil />
        </Button>
      ) : null}
      <Button
        aria-label="Open details sidebar"
        className="lg:hidden"
        size="icon"
        type="button"
        variant="ghost"
        onClick={onDetails}
      >
        <PiSidebarSimple className="rotate-180" />
      </Button>
    </header>
  );
}
