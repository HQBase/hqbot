import { PiArchive, PiArrowCounterClockwise } from "react-icons/pi";

import type { WorkspaceController } from "../hooks/use-workspace";
import { ChatComposer } from "./chat/chat-composer";
import { NewTeammateWelcome } from "./chat/new-teammate-welcome";
import { ConversationHeader } from "./conversation-header";
import { RealtimeConversation } from "./realtime-conversation";
import { Button } from "./ui/button";

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
    if (controller.selectedBot.hidden) {
      return <ArchivedConversation controller={controller} showBack={showBack} />;
    }
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
          teammates={[]}
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

function ArchivedConversation({
  controller,
  showBack
}: {
  controller: WorkspaceController;
  showBack: boolean;
}) {
  const bot = controller.selectedBot;
  if (!bot) return null;
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-reader">
      <ConversationHeader
        bot={bot}
        detailsOpen={controller.detailsOpen}
        showBack={showBack}
        status="Archived"
        working={false}
        onBack={() => controller.setMobileChatOpen(false)}
        onDetails={() => controller.setDetailsOpen(!controller.detailsOpen)}
        onEdit={() => controller.setDialog("profile")}
        onStop={() => undefined}
      />
      <div className="flex min-h-0 flex-1 items-center justify-center bg-card/30 p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground">
            <PiArchive />
          </span>
          <div>
            <h2 className="text-sm font-semibold">{bot.name} is archived</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Its routines, mailbox connection, and active work are stopped. Restore it before you
              send a message.
            </p>
          </div>
          {controller.error ? <p className="text-xs text-destructive">{controller.error}</p> : null}
          <Button type="button" onClick={() => void controller.restoreSelectedBot()}>
            <PiArrowCounterClockwise data-icon="inline-start" /> Restore teammate
          </Button>
        </div>
      </div>
    </section>
  );
}
