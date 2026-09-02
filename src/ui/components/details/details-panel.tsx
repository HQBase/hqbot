import type { BotSkill } from "../../../domain/types";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { AgentSettingsPanel } from "./agent-settings-panel";
import { CostPanel } from "./cost-panel";
import { DesktopView } from "./desktop-view";
import { ResourcesPanel } from "./resources-panel";

export function DetailsPanel({
  controller,
  onUseSkill
}: {
  controller: WorkspaceController;
  onUseSkill: (skill: BotSkill) => void;
}) {
  const { selectedBot, snapshot } = controller;
  if (!snapshot || !selectedBot) {
    return (
      <aside className="flex h-full w-full shrink-0 items-center justify-center border-l border-divider bg-list p-6 pt-14 text-center text-xs text-muted-foreground lg:w-[22rem] lg:pt-6">
        Choose a teammate to see its computer, tools, and costs.
      </aside>
    );
  }
  return (
    <aside className="h-full w-full shrink-0 overflow-y-auto border-l border-divider bg-list px-4 pt-14 lg:w-[22rem] lg:pt-2">
      <div className="flex flex-col" key={selectedBot.id}>
        <AgentSettingsPanel
          bot={selectedBot}
          onDeleted={() => controller.deleteSelectedBot()}
          onMaxStepsChange={(maxSteps) => controller.setMaxSteps(maxSteps)}
          onModelChange={(modelId) => controller.setModel(modelId)}
          onSaved={(botId) => controller.load(botId)}
        />
        <DesktopView active={selectedBot.status === "working"} botId={selectedBot.id} />
        <ResourcesPanel
          bot={selectedBot}
          task={snapshot.activeTask}
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
          onStopTask={() => void controller.stopSelectedTask()}
          onUseSkill={onUseSkill}
        />
        <CostPanel budgetUsd={selectedBot.dailyBudgetUsd} costs={snapshot.costs} />
      </div>
    </aside>
  );
}
