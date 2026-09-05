import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ActionHistoryPanel } from "./action-history-panel";
import { TaskProgressPanel } from "./task-progress-panel";

export function ActivityPanel({ botId, revision }: { botId: string; revision?: string }) {
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
        <TaskProgressPanel botId={botId} revision={revision} />
      </TabsContent>
      <TabsContent value="actions">
        <ActionHistoryPanel botId={botId} />
      </TabsContent>
    </Tabs>
  );
}
