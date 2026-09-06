import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ActionHistoryPanel } from "./action-history-panel";
import { TaskProgressPanel } from "./task-progress-panel";
import { TeamProgress } from "./team-progress";

export function ActivityPanel({ botId, revision }: { botId: string; revision?: string }) {
  const [hasTeamWork, setHasTeamWork] = useState(false);
  return (
    <Tabs defaultValue="progress" className="py-4">
      <TabsList aria-label="Activity views" className="w-full">
        <TabsTrigger className="flex-1" value="progress">
          Progress
        </TabsTrigger>
        <TabsTrigger className="flex-1" value="actions">
          Actions
        </TabsTrigger>
      </TabsList>
      <TabsContent value="progress">
        <TeamProgress key={botId} botId={botId} onLoaded={setHasTeamWork} />
        <TaskProgressPanel hideEmpty={hasTeamWork} botId={botId} revision={revision} />
      </TabsContent>
      <TabsContent value="actions">
        <ActionHistoryPanel botId={botId} />
      </TabsContent>
    </Tabs>
  );
}
