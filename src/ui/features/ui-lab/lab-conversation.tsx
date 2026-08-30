import { useChat } from "@ai-sdk/react";
import { createChat } from "@shadcn/helpers/ai-sdk";
import { useState } from "react";
import { PiArrowRight } from "react-icons/pi";

import type { BotTeammate } from "../../../domain/types";
import {
  AgentMessage,
  type AgentPart,
  ThinkingIndicator
} from "../../components/chat/agent-message";
import { ApprovalCard } from "../../components/chat/approval-card";
import { ChatComposer } from "../../components/chat/chat-composer";
import { ConversationHeader } from "../../components/conversation-header";
import { Button } from "../../components/ui/button";
import { labBots } from "./fixtures";

export type ConversationState = "error" | "live" | "reconnecting";

const streamFixture = createChat({
  messageIdPrefix: "hqbot-preview-message",
  now: "2026-08-30T14:00:00.000Z",
  sourceIdPrefix: "hqbot-preview-source",
  toolCallIdPrefix: "hqbot-preview-tool"
})
  .user("Find the current Browser Run pricing and give me the short version.")
  .assistant(({ writer }) => {
    writer.reasoning("I should use the browser because the request asks for current pricing.");
    writer
      .tool("browser", {
        dynamic: true,
        input: { url: "https://developers.cloudflare.com/browser-run/pricing/" },
        title: "Opening Cloudflare pricing"
      })
      .sleep(450)
      .output({ page: "Browser Run pricing", status: "read" });
    writer.sourceUrl({
      title: "Cloudflare Browser Run pricing",
      url: "https://developers.cloudflare.com/browser-run/pricing/"
    });
    writer.text("Browser time is metered only while the session runs.");
  });

export function LabConversation({
  bot,
  mode,
  showBack = false
}: {
  bot: BotTeammate;
  mode: ConversationState;
  showBack?: boolean;
}) {
  const [prompt, setPrompt] = useState("Ask @Support to prepare a customer reply");
  const error =
    mode === "reconnecting"
      ? "Realtime connection interrupted. HQBot is reconnecting."
      : mode === "error"
        ? "HQBot could not reach Browser Run. Try again."
        : "";
  const status = mode === "reconnecting" ? "Recovering" : mode === "error" ? "Offline" : "Live";

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-reader">
      <ConversationHeader
        bot={bot}
        showBack={showBack}
        status={status}
        working={mode === "reconnecting"}
        onBack={() => undefined}
        onDetails={() => undefined}
        onEdit={() => undefined}
        onStop={() => undefined}
      />
      <div className="min-h-0 flex-1 overflow-y-auto bg-card/30" aria-live="polite">
        <div className="mx-auto flex w-full max-w-[780px] flex-col gap-7 px-4 py-8 sm:px-8">
          <AgentMessage
            name="You"
            parts={[{ text: "Find the current Browser Run pricing.", type: "text" }]}
            speaker="user"
          />
          <AgentMessage name={bot.name} parts={partsFor(mode)} speaker="assistant" />
          {mode === "live" ? (
            <ApprovalCard
              description="Send the researched answer through HQBase"
              draft="Browser time is billed only while the session runs."
              pending={false}
              title="Review this reply"
              onApprove={() => undefined}
              onDeny={() => undefined}
            />
          ) : null}
        </div>
      </div>
      <div className="shrink-0 bg-gradient-to-t from-reader via-reader to-reader/80 pt-2">
        <ChatComposer
          attachedFiles={[]}
          bot={bot}
          error={error}
          prompt={prompt}
          sending={mode === "reconnecting"}
          teammates={labBots}
          uploading={false}
          onConnect={() => undefined}
          onPromptChange={setPrompt}
          onRemoveFile={() => undefined}
          onSend={() => setPrompt("")}
          onUpload={() => undefined}
        />
      </div>
    </section>
  );
}

export function StreamingConversation({ bot }: { bot: BotTeammate }) {
  const { messages, sendMessage, status } = useChat({
    messages: streamFixture.get(0),
    transport: streamFixture.transport({ delayMs: 20 })
  });
  const next = streamFixture.next(messages);
  const busy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);
  const showThinking =
    busy &&
    (lastMessage?.role !== "assistant" ||
      !lastMessage.parts.some((part) =>
        part.type === "text" || part.type === "reasoning"
          ? Boolean(part.text.trim())
          : part.type.startsWith("tool-") || part.type === "dynamic-tool"
      ));
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-reader">
      <ConversationHeader
        bot={bot}
        showBack={false}
        status={busy ? "Working" : "Ready"}
        working={busy}
        onBack={() => undefined}
        onDetails={() => undefined}
        onEdit={() => undefined}
        onStop={() => undefined}
      />
      <div className="min-h-0 flex-1 overflow-y-auto bg-card/30">
        <div className="mx-auto flex w-full max-w-[780px] flex-col gap-7 px-4 py-8 sm:px-8">
          {messages.map((message) => (
            <AgentMessage
              key={message.id}
              name={message.role === "user" ? "You" : bot.name}
              parts={message.parts as unknown as AgentPart[]}
              speaker={message.role === "user" ? "user" : "assistant"}
            />
          ))}
          {showThinking ? <ThinkingIndicator name={bot.name} /> : null}
          <Button
            className="self-center"
            disabled={!next || busy}
            type="button"
            onClick={() => next && void sendMessage(next)}
          >
            {busy ? "Streaming…" : messages.length === 0 ? "Replay task" : "Fixture complete"}
            <PiArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </section>
  );
}

function partsFor(mode: ConversationState): AgentPart[] {
  if (mode === "error") {
    return [
      {
        errorText: "Browser Run session ended before the page loaded.",
        state: "output-error",
        title: "Opening Cloudflare pricing",
        toolCallId: "browser-error",
        type: "dynamic-tool"
      }
    ];
  }
  if (mode === "reconnecting") {
    return [
      { text: "I saved the task. I will continue after the connection returns.", type: "text" }
    ];
  }
  return [
    {
      output: { page: "Browser Run pricing", status: "read" },
      state: "output-available",
      title: "Opening Cloudflare pricing",
      toolCallId: "browser-done",
      type: "dynamic-tool"
    },
    { text: "Browser time is metered only while the session runs.", type: "text" }
  ];
}
