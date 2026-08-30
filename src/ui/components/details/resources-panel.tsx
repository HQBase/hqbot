import type { ComponentType, ReactNode } from "react";
import { PiCalendar, PiFile, PiPause, PiPlay, PiPlus, PiSparkle, PiTrash } from "react-icons/pi";

import type { BotFile, BotMemory, BotRoutine, BotSkill, BotTeammate } from "../../../domain/types";
import { formatInterval } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DetailsSection } from "./details-section";

export function ResourcesPanel({
  bot,
  files,
  memories,
  routines,
  skills,
  onDeleteRoutine,
  onNewRoutine,
  onNewSkill,
  onSetRoutineActive,
  onUseSkill
}: {
  bot: BotTeammate;
  files: BotFile[];
  memories: BotMemory[];
  routines: BotRoutine[];
  skills: BotSkill[];
  onDeleteRoutine: (routine: BotRoutine) => void;
  onNewRoutine: () => void;
  onNewSkill: () => void;
  onSetRoutineActive: (routine: BotRoutine, active: boolean) => void;
  onUseSkill: (skill: BotSkill) => void;
}) {
  return (
    <>
      <ResourceSection
        actionLabel="New skill"
        count={skills.length}
        icon={PiSparkle}
        title="Skills"
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
      </ResourceSection>
      <ResourceSection
        actionLabel="New routine"
        count={routines.length}
        icon={PiCalendar}
        id="routines"
        title="Routines"
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
              <span className="flex shrink-0 items-center gap-1">
                <Badge variant="outline">{routine.active ? "On" : "Paused"}</Badge>
                <Button
                  aria-label={`${routine.active ? "Pause" : "Resume"} ${routine.name}`}
                  disabled={bot.hidden && !routine.active}
                  size="icon"
                  title={
                    bot.hidden && !routine.active
                      ? "Restore this teammate before you resume the routine"
                      : undefined
                  }
                  type="button"
                  variant="ghost"
                  onClick={() => onSetRoutineActive(routine, !routine.active)}
                >
                  {routine.active ? <PiPause /> : <PiPlay />}
                </Button>
                <Button
                  aria-label={`Delete ${routine.name}`}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => onDeleteRoutine(routine)}
                >
                  <PiTrash />
                </Button>
              </span>
            </div>
          ))
        )}
      </ResourceSection>
      <ResourceSection count={files.length} icon={PiFile} title="Files">
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
      </ResourceSection>
      {memories.length > 0 ? (
        <ResourceSection count={memories.length} icon={PiSparkle} title="Memory">
          {memories.slice(0, 4).map((memory) => (
            <p className="px-2 py-1.5 text-xs leading-5 text-muted-foreground" key={memory.id}>
              {memory.content}
            </p>
          ))}
        </ResourceSection>
      ) : null}
    </>
  );
}

function ResourceSection({
  actionLabel,
  children,
  count,
  icon,
  id,
  title,
  onAction
}: {
  actionLabel?: string;
  children: ReactNode;
  count: number;
  icon: ComponentType<{ className?: string }>;
  id?: string;
  title: string;
  onAction?: () => void;
}) {
  return (
    <DetailsSection badge={count} icon={icon} id={id} title={title}>
      {onAction ? (
        <div className="mb-1 flex justify-end">
          <Button size="sm" type="button" variant="ghost" onClick={onAction}>
            <PiPlus data-icon="inline-start" /> {actionLabel}
          </Button>
        </div>
      ) : null}
      {children}
    </DetailsSection>
  );
}

function EmptyText({ children }: { children: ReactNode }) {
  return <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">{children}</p>;
}
