import type { MessageSource } from "../domain/messages";
import { WorkspaceDemonstrationsAgent } from "./demonstrations-agent";
import { WorkspaceMessages } from "./messages";

export class WorkspaceMessagesAgent extends WorkspaceDemonstrationsAgent {
  searchWorkspace(query: string) {
    return new WorkspaceMessages(this.db).search(query);
  }
  readDiscussion(source: MessageSource, userId: string) {
    return new WorkspaceMessages(this.db).read(source, userId);
  }
  addDiscussionNote(source: MessageSource, userId: string, input: unknown) {
    return this.ctx.storage.transactionSync(() =>
      new WorkspaceMessages(this.db).addNote(source, userId, input)
    );
  }
  reactToMessage(source: MessageSource, userId: string, input: unknown) {
    return this.ctx.storage.transactionSync(() =>
      new WorkspaceMessages(this.db).react(source, userId, input)
    );
  }
  projectMessage(projectId: string, messageId: string) {
    return (
      this.db<{
        content: string;
      }>`SELECT content FROM project_messages WHERE project_id = ${projectId} AND id = ${messageId}`[0]
        ?.content ?? null
    );
  }
}
