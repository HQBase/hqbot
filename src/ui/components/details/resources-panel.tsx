import type { ComponentType, ReactNode } from "react";
import { PiCalendar, PiFile, PiLink, PiPlus, PiSparkle } from "react-icons/pi";

import type { BotFile, BotMemory, BotRoutine, BotSkill, BotTeammate } from "../../../domain/types";
import { formatInterval } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Separator } from "../ui/separator";

export function ResourcesPanel({
  bot,
  files,
  memories,
  routines,
  skills,
  onConnect,
  onNewRoutine,
  onNewSkill,
  onUseSkill
}: {
  bot: BotTeammate;
  files: BotFile[];
  memories: BotMemory[];
  routines: BotRoutine[];
  skills: BotSkill[];
  onConnect: () => void;
  onNewRoutine: () => void;
  onNewSkill: () => void;
  onUseSkill: (skill: BotSkill) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Card className="shadow-none">
        <CardHeader className="flex-row items-start justify-between gap-3 p-4 pb-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              <PiLink /> HQBase
            </CardTitle>
            <CardDescription className="truncate text-xs">
              {bot.connection?.mailboxAddress ?? "No mailbox connected"}
            </CardDescription>
          </div>
          {bot.connection ? (
            <Badge>On</Badge>
          ) : (
            <Button size="sm" type="button" variant="outline" onClick={onConnect}>
              Connect
            </Button>
          )}
        </CardHeader>
      </Card>
      <ResourceCard
        icon={PiSparkle}
        title="Skills"
        actionLabel="New skill"
        count={skills.length}
        onAction={onNewSkill}
      >
        {skills.length === 0 ? (
          <EmptyText>Reusable instructions appear here.</EmptyText>
        ) : (
          skills.map((skill) => (
            <button
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
              key={skill.id}
              type="button"
              onClick={() => onUseSkill(skill)}
            >
              <span className="min-w-0">
                <strong className="block truncate text-xs">
                  /{skill.name.toLowerCase().replaceAll(" ", "-")}
                </strong>
                <small className="block truncate text-[11px] text-muted-foreground">
                  {skill.description}
                </small>
              </span>
              <span className="text-[10px] text-tertiary">Use</span>
            </button>
          ))
        )}
      </ResourceCard>
      <ResourceCard
        icon={PiCalendar}
        id="routines"
        title="Routines"
        actionLabel="New routine"
        count={routines.length}
        onAction={onNewRoutine}
      >
        {routines.length === 0 ? (
          <EmptyText>Scheduled work appears here.</EmptyText>
        ) : (
          routines.map((routine) => (
            <div
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2"
              key={routine.id}
            >
              <span className="min-w-0">
                <strong className="block truncate text-xs">{routine.name}</strong>
                <small className="block text-[11px] text-muted-foreground">
                  Every {formatInterval(routine.intervalMinutes)}
                </small>
              </span>
              <Badge variant="outline">{routine.active ? "On" : "Paused"}</Badge>
            </div>
          ))
        )}
      </ResourceCard>
      <ResourceCard icon={PiFile} title="Files" count={files.length}>
        {files.length === 0 ? (
          <EmptyText>Files attached in chat stay with {bot.name}.</EmptyText>
        ) : (
          files.slice(0, 5).map((file) => (
            <div className="flex items-center gap-2 rounded-md px-2 py-2 text-xs" key={file.id}>
              <PiFile className="shrink-0 text-tertiary" />
              <span className="truncate">{file.name}</span>
            </div>
          ))
        )}
      </ResourceCard>
      {memories.length > 0 ? (
        <ResourceCard icon={PiSparkle} title="Memory" count={memories.length}>
          {memories.slice(0, 4).map((memory) => (
            <p
              className="rounded-md px-2 py-1.5 text-xs leading-5 text-muted-foreground"
              key={memory.id}
            >
              {memory.content}
            </p>
          ))}
        </ResourceCard>
      ) : null}
    </div>
  );
}

function ResourceCard({
  actionLabel,
  children,
  count,
  icon: Icon,
  id,
  title,
  onAction
}: {
  actionLabel?: string;
  children: ReactNode;
  count: number;
  icon: ComponentType;
  id?: string;
  title: string;
  onAction?: () => void;
}) {
  return (
    <Card className="scroll-mt-3 shadow-none" id={id}>
      <CardHeader className="flex-row items-center justify-between gap-3 p-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon /> {title}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{count}</Badge>
          {onAction ? (
            <Button
              aria-label={actionLabel}
              size="icon"
              type="button"
              variant="ghost"
              onClick={onAction}
            >
              <PiPlus />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="p-2">{children}</CardContent>
    </Card>
  );
}

function EmptyText({ children }: { children: ReactNode }) {
  return <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">{children}</p>;
}
