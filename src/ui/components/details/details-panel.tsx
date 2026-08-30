import type { BotSkill } from "../../../domain/types";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { CostPanel } from "./cost-panel";
import { LiveView } from "./live-view";
import { ModelPanel } from "./model-panel";
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
    <aside className="h-full w-full shrink-0 overflow-y-auto border-l border-divider bg-list px-4 pt-14 lg:w-[22rem] lg:pt-2">
      <div className="flex flex-col">
        <ModelPanel
          modelId={selectedBot.modelId}
          onModelChange={(modelId) => controller.setModel(modelId)}
        />
        <LiveView
          botId={selectedBot.id}
          computer={snapshot.computer}
          key={selectedBot.id}
          task={selectedTask}
        />
        <CostPanel budgetUsd={selectedBot.dailyBudgetUsd} costs={snapshot.costs} />
        <ResourcesPanel
          bot={selectedBot}
          files={snapshot.files}
          memories={snapshot.memories}
          routines={snapshot.routines}
          skills={snapshot.skills}
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
