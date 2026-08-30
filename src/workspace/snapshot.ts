import type { TaskStatus, WorkspaceSnapshot } from "../domain/types";
import type { WorkspaceCatalog } from "./catalog";
import type { WorkspaceTasks } from "./tasks";

const REALTIME_DURABLE_OBJECT_GB_SECONDS_PER_DAY = 0.125 * 60 * 60 * 24;

function terminal(status: TaskStatus): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

export function readWorkspaceSnapshot(
  catalog: WorkspaceCatalog,
  taskStore: WorkspaceTasks,
  botId?: string
): WorkspaceSnapshot {
  const bots = catalog.listBots();
  const selectedBot = bots.find((candidate) => candidate.id === botId) ?? bots[0] ?? null;
  const tasks = selectedBot ? taskStore.listTasks(selectedBot.id) : [];
  const activeTask = tasks.find((task) => !terminal(task.status)) ?? tasks[0] ?? null;
  const computer = catalog.getComputerState();
  const realtimeConnections = catalog
    .listActiveConnections()
    .filter((connection) => connection.realtimeStatus === "connected");
  return {
    bots,
    selectedBot,
    tasks,
    activeTask,
    activity: activeTask ? taskStore.listActivity(activeTask.id) : [],
    memories: selectedBot ? catalog.listMemories(selectedBot.id) : [],
    routines: selectedBot ? catalog.listRoutines(selectedBot.id) : [],
    files: selectedBot ? catalog.listFiles(selectedBot.id) : [],
    skills: selectedBot ? catalog.listSkills(selectedBot.id) : [],
    computer: {
      active: computer.active,
      url: computer.url,
      screenshotKey: computer.screenshotKey,
      expiresAt: computer.expiresAt,
      updatedAt: computer.updatedAt
    },
    costs: taskStore.getCosts(selectedBot?.id, activeTask?.id, {
      durableObjectGbSecondsPerDay:
        realtimeConnections.length > 0 ? REALTIME_DURABLE_OBJECT_GB_SECONDS_PER_DAY : 0,
      hqbaseRealtimeConnections: realtimeConnections.length,
      selectedBotHqbaseRealtime: realtimeConnections.some(
        (connection) => connection.botId === selectedBot?.id
      )
    })
  };
}
