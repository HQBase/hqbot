import type { TaskStatus, WorkspaceSnapshot } from "../domain/types";
import type { WorkspaceCatalog } from "./catalog";
import type { WorkspaceTasks } from "./tasks";

function terminal(status: TaskStatus): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

export function readWorkspaceSnapshot(
  catalog: WorkspaceCatalog,
  taskStore: WorkspaceTasks,
  botId?: string
): WorkspaceSnapshot {
  const bots = catalog.listBots();
  const archivedBots = catalog.listArchivedBots();
  const selectedBot =
    [...bots, ...archivedBots].find((candidate) => candidate.id === botId) ?? bots[0] ?? null;
  const tasks = selectedBot ? taskStore.listTasks(selectedBot.id) : [];
  const activeTask = tasks.find((task) => !terminal(task.status)) ?? tasks[0] ?? null;
  const computer = catalog.getComputerState();
  return {
    bots,
    archivedBots,
    selectedBot,
    tasks,
    activeTask,
    activity: activeTask ? taskStore.listActivity(activeTask.id) : [],
    memories: selectedBot ? catalog.listMemories(selectedBot.id) : [],
    routines: selectedBot ? catalog.automations.listRoutines(selectedBot.id) : [],
    files: selectedBot ? catalog.listFiles(selectedBot.id) : [],
    skills: selectedBot ? catalog.listSkills(selectedBot.id) : [],
    computer: {
      active: computer.active,
      url: computer.url,
      screenshotKey: computer.screenshotKey,
      expiresAt: computer.expiresAt,
      updatedAt: computer.updatedAt
    },
    costs: taskStore.getCosts(selectedBot?.id, activeTask?.id)
  };
}
