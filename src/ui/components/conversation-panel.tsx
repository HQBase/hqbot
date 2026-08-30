import type { WorkspaceController } from "../hooks/use-workspace";
import { ChatComposer } from "./chat/chat-composer";
import { NewTeammateWelcome } from "./chat/new-teammate-welcome";
import { ConversationHeader } from "./conversation-header";
import { RealtimeConversation } from "./realtime-conversation";

export function ConversationPanel({
  controller,
  prompt,
  showBack = false,
  onPromptChange
}: {
  controller: WorkspaceController;
  prompt: string;
  showBack?: boolean;
  onPromptChange: (value: string) => void;
}) {
  if (controller.selectedBot && !controller.newTeammate) {
    return (
      <RealtimeConversation
        bot={controller.selectedBot}
        controller={controller}
        key={controller.selectedBot.id}
        prompt={prompt}
        showBack={showBack}
        onPromptChange={onPromptChange}
      />
    );
  }

  async function createTeammate(): Promise<void> {
    if (await controller.send(prompt)) onPromptChange("");
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-reader">
      <ConversationHeader
        bot={null}
        detailsOpen={controller.detailsOpen}
        showBack={showBack}
        status="Ready"
        working={controller.sending}
        onBack={() => controller.setMobileChatOpen(false)}
        onDetails={() => controller.setDetailsOpen(!controller.detailsOpen)}
        onEdit={() => undefined}
        onStop={() => undefined}
      />
      <div className="min-h-0 flex-1 overflow-y-auto bg-card/30">
        <NewTeammateWelcome onSuggestion={onPromptChange} />
      </div>
      <div className="shrink-0 bg-gradient-to-t from-reader via-reader to-reader/80 pt-2">
        <ChatComposer
          attachedFiles={[]}
          bot={null}
          error={controller.error}
          prompt={prompt}
          sending={controller.sending}
          uploading={false}
          onConnect={() => undefined}
          onPromptChange={onPromptChange}
          onRemoveFile={() => undefined}
          onSend={() => void createTeammate()}
          onUpload={() => undefined}
        />
      </div>
    </section>
  );
}
