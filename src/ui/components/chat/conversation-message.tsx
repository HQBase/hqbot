import type { UIMessage } from "ai";
import { PiUsersThree } from "react-icons/pi";
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
  if (message.role === "user" && message.id.startsWith("team-work:")) {
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const assignment = text
      .split("\n")
      .find((line) => line.startsWith("Assignment: "))
      ?.slice(12);
    return (
      <div
        id={`message-${message.id}`}
        className="mx-auto flex max-w-lg items-start gap-2 rounded-xl border border-divider bg-muted/40 px-4 py-3 text-xs text-muted-foreground"
      >
        <PiUsersThree aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-foreground">
            {assignment ? "Team assignment" : "Team review"}
          </p>
          <p className="break-words leading-relaxed">
            {assignment ?? "Review the saved results and continue the team task."}
          </p>
        </div>
      </div>
    );
  }
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
