import type { UIMessage } from "ai";
import type { BotTeammate } from "../../../domain/types";
import { AgentMessage, type AgentPart } from "./agent-message";
import { MessageDiscussion } from "./message-discussion";

export function ConversationMessage({
  message,
  bot,
  onAsk
}: {
  message: UIMessage;
  bot: BotTeammate;
  onAsk: (text: string) => void;
}) {
  if (message.role !== "user" && message.role !== "assistant") return null;
  return (
    <div id={`message-${message.id}`} className="space-y-1">
      <AgentMessage
        name={message.role === "user" ? "You" : bot.name}
        parts={message.parts as AgentPart[]}
        speaker={message.role}
      />
      <div className={message.role === "user" ? "flex justify-end" : "ml-12"}>
        <MessageDiscussion
          source={{ kind: "bot", id: bot.id, messageId: message.id }}
          onAsk={onAsk}
        />
      </div>
    </div>
  );
}
