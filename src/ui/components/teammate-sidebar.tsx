import { useEffect, useMemo, useState } from "react";
import { PiMagnifyingGlass, PiPlus, PiPushPinSimpleFill } from "react-icons/pi";

import type { BotTeammate } from "../../domain/types";
import { initials, relativeTime } from "../lib/format";
import type { TeammateSummary } from "../types";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function TeammateSidebar({
  bots,
  selectedId,
  onCreate,
  onSelect
}: {
  bots: TeammateSummary[];
  selectedId: string | null;
  onCreate: () => void;
  onSelect: (bot: BotTeammate) => void;
}) {
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = useMemo(
    () =>
      bots
        .filter((bot) => !bot.hidden)
        .filter((bot) => `${bot.name} ${bot.title}`.toLowerCase().includes(query.toLowerCase()))
        .sort(
          (left, right) =>
            new Date(right.lastInteractedAt ?? right.updatedAt).getTime() -
            new Date(left.lastInteractedAt ?? left.updatedAt).getTime()
        ),
    [bots, query]
  );

  return (
    <aside className="flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-divider bg-sidebar p-2 shadow-sm">
      <div className="mb-3 flex h-9 items-center justify-between gap-3 px-3.5 pr-0">
        <span className="truncate text-sm font-semibold leading-none tracking-tight">
          Teammates
        </span>
        <Button
          aria-label="New teammate"
          className="size-10 min-h-10 min-w-10 text-tertiary"
          size="icon"
          type="button"
          variant="ghost"
          onClick={onCreate}
        >
          <PiPlus />
        </Button>
      </div>
      <div className="relative mb-2 px-1.5">
        <PiMagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-tertiary" />
        <Input
          aria-label="Search teammates"
          className="h-9 bg-muted/70 pl-8 text-xs shadow-none"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <nav aria-label="Teammates" className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">
            {query ? "No teammates match this search." : "Create your first teammate."}
          </div>
        ) : (
          visible.map((bot) => (
            <button
              aria-current={selectedId === bot.id ? "page" : undefined}
              className={`group grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl px-3 py-3 text-left transition-colors ${
                selectedId === bot.id ? "bg-selected" : "[@media(hover:hover)]:hover:bg-hover"
              }`}
              key={bot.id}
              type="button"
              onClick={() => onSelect(bot)}
            >
              <Avatar className="size-10">
                <AvatarFallback className="font-medium">{initials(bot.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <strong className="truncate text-[13px] font-medium">{bot.name}</strong>
                  {bot.pinned ? (
                    <PiPushPinSimpleFill className="size-3 shrink-0 text-tertiary" />
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {bot.lastMessage ?? bot.connection?.mailboxAddress ?? bot.title}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <time className="tabular-nums text-[11px] text-tertiary">
                  {relativeTime(bot.lastInteractedAt ?? bot.updatedAt, now)}
                </time>
                {bot.status === "working" ? (
                  <span className="size-1.5 rounded-full bg-foreground" title="Working" />
                ) : bot.status === "needs_approval" ? (
                  <span className="size-1.5 rounded-full bg-star" title="Needs approval" />
                ) : bot.unreadCount ? (
                  <span className="flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                    {bot.unreadCount}
                  </span>
                ) : null}
              </span>
            </button>
          ))
        )}
      </nav>
      <Button
        className="btn-liquid-glass mt-2 h-10 w-full justify-start rounded-full px-3.5"
        type="button"
        variant="ghost"
        onClick={onCreate}
      >
        <PiPlus data-icon="inline-start" /> New teammate
      </Button>
    </aside>
  );
}
