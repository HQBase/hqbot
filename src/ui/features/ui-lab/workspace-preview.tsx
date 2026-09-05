import { useState } from "react";
import { WorkspaceShell } from "../../components/workspace-shell";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { labArchivedBots, labBots, labCosts } from "./fixtures";
import { installWorkspaceFixtures } from "./workspace-fixtures";

installWorkspaceFixtures();
export function WorkspacePreview() {
  const [selectedBot, selectBot] = useState(labBots[0]);
  const [mobileChatOpen, setMobileChatOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  const done = async () => undefined;
  const controller = {
    snapshot: {
      bots: labBots,
      archivedBots: labArchivedBots,
      selectedBot,
      tasks: [],
      activeTask: null,
      activity: [],
      memories: [],
      routines: [],
      files: [],
      skills: [],
      costs: labCosts,
      notifications: [
        {
          id: "notification",
          botId: "support",
          taskId: null,
          kind: "needs_user",
          title: "A reply is ready for review",
          message: "Support has prepared a response. Review it when you are ready.",
          createdAt: new Date().toISOString(),
          readAt: null
        }
      ]
    },
    selectedBot,
    selectBot,
    mobileChatOpen,
    setMobileChatOpen,
    detailsOpen,
    setDetailsOpen,
    dialog,
    setDialog,
    load: done,
    logout: done,
    beginNewTeammate: done,
    deleteSelectedBot: done,
    setMaxSteps: done,
    setModel: done,
    selectedTask: null,
    newTeammate: false,
    sending: false,
    error: "",
    pendingInitialMessage: null,
    realtimeStatus: "connected",
    takePendingInitialMessage: () => null,
    send: done,
    stopSelectedBot: done,
    stopSelectedTask: done,
    setRoutineActive: done,
    deleteRoutine: done,
    restoreSelectedBot: done,
    setError: () => undefined
  } as unknown as WorkspaceController;
  return <WorkspaceShell controller={controller} />;
}
