import type { BotSkill } from "../../../domain/types";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { CostPanel } from "./cost-panel";
import { LiveView } from "./live-view";
import { ResourcesPanel } from "./resources-panel";

export function DetailsPanel({
  controller,
  onUseSkill
}: {
  controller: WorkspaceController;
  onUseSkill: (skill: BotSkill) => void;
}) {
  const { selectedBot, selectedTask, snapshot } = controller;
  if (!snapshot || !selectedBot) {
    return (
      <aside className="flex h-full w-full shrink-0 items-center justify-center border-l border-divider bg-list p-6 pt-14 text-center text-xs text-muted-foreground lg:w-[22rem] lg:pt-6">
        Choose a teammate to see its computer, tools, and costs.
      </aside>
    );
  }
  return (
    <aside className="h-full w-full shrink-0 overflow-y-auto border-l border-divider bg-list p-3 pt-14 lg:w-[22rem] lg:pt-3">
      <div className="flex flex-col gap-3">
        <LiveView
          botId={selectedBot.id}
          computer={snapshot.computer}
          key={selectedBot.id}
          task={selectedTask}
        />
        <CostPanel
          budgetUsd={selectedBot.dailyBudgetUsd}
          costs={snapshot.costs}
          modelId={selectedBot.modelId}
        />
        <ResourcesPanel
          bot={selectedBot}
          files={snapshot.files}
          memories={snapshot.memories}
          routines={snapshot.routines}
          skills={snapshot.skills}
          onConnect={() => controller.setDialog("connection")}
          onDeleteRoutine={(routine) => void controller.deleteRoutine(routine)}
          onNewRoutine={() => controller.setDialog("routine")}
          onNewSkill={() => controller.setDialog("skill")}
          onSetRoutineActive={(routine, active) =>
            void controller.setRoutineActive(routine, active)
          }
          onUseSkill={onUseSkill}
        />
      </div>
    </aside>
  );
}
