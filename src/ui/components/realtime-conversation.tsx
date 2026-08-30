import type { PendingAction } from "@cloudflare/codemode";
import { useAgentChat } from "@cloudflare/think/react";
import { useAgent } from "agents/react";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import type { BotTeammate } from "../../domain/types";
import type { WorkspaceController } from "../hooks/use-workspace";
import * as initialMessage from "../lib/initial-message";
import { integrationActionDetails, type TeammateIntegrationClient } from "../lib/mcp";
import { AgentMessage, type AgentPart, ThinkingIndicator } from "./chat/agent-message";
import { ApprovalCard } from "./chat/approval-card";
import { ChatComposer, type ComposerFile } from "./chat/chat-composer";
import { ConversationHeader } from "./conversation-header";

type LocalFile = ComposerFile & { file: File };
export function RealtimeConversation({
  bot,
  controller,
  prompt,
  showBack,
  onPromptChange
}: {
  bot: BotTeammate;
  controller: WorkspaceController;
  prompt: string;
  showBack: boolean;
  onPromptChange: (value: string) => void;
}) {
  const agent = useAgent<TeammateIntegrationClient, unknown>({
    agent: "HQBOT_TEAMMATE",
    name: bot.id
  });
  const chat = useAgentChat({ agent, credentials: "include", throttle: 50 });
  const [approvals, setApprovals] = useState<PendingAction[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [localError, setLocalError] = useState("");
  const [initialRetry, setInitialRetry] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const initialSubmissionRef = useRef<string | null>(null);
  const refreshApprovals = useCallback(async () => {
    try {
      setApprovals(await agent.stub.listIntegrationApprovals());
    } catch {
      // A reconnect or terminal close will retry when chat becomes ready.
    }
  }, [agent.stub]);
  useEffect(() => {
    if (chat.status !== "ready") return;
    void refreshApprovals();
    void controller.load(bot.id);
  }, [bot.id, chat.status, controller.load, refreshApprovals]);
  const queuedInitialMessage = controller.pendingInitialMessage?.botId === bot.id;
  useEffect(() => {
    if (!queuedInitialMessage) return;
    let active = true;
    let retryTimer: number | undefined;
    void (async () => {
      try {
        await agent.ready;
        if (!active || initialSubmissionRef.current === bot.id) return;
        const text = controller.pendingInitialMessage?.text;
        if (!text) return;
        initialSubmissionRef.current = bot.id;
        setLocalError("");
        await initialMessage.submitInitialMessage(bot.id, text);
      } catch (cause) {
        if (!active) return;
        if (cause instanceof initialMessage.InitialMessageAdmissionUnknownError) {
          setLocalError(cause.message);
          retryTimer = initialMessage.scheduleInitialMessageRetry(initialRetry, () => {
            initialSubmissionRef.current = null;
            setInitialRetry((current) => current + 1);
          });
          return;
        }
        initialSubmissionRef.current = null;
        setInitialRetry(0);
        const text = controller.takePendingInitialMessage(bot.id);
        if (text) onPromptChange(text);
        setLocalError(cause instanceof Error ? cause.message : "The message could not be sent");
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [
    agent.ready,
    bot.id,
    controller.pendingInitialMessage,
    controller.takePendingInitialMessage,
    initialRetry,
    onPromptChange,
    queuedInitialMessage
  ]);
  const initialMessageId = `chat:first:${bot.id}`;
  useEffect(() => {
    if (queuedInitialMessage && chat.messages.some((message) => message.id === initialMessageId)) {
      controller.takePendingInitialMessage(bot.id);
      setLocalError("");
      setInitialRetry(0);
    }
  }, [
    bot.id,
    chat.messages,
    controller.takePendingInitialMessage,
    initialMessageId,
    queuedInitialMessage
  ]);
  const approvalRevision = approvals
    .map((approval) => `${approval.executionId}:${approval.seq}`)
    .join(":");
  useEffect(() => {
    if (chat.messages.length > 0 || approvalRevision)
      endRef.current?.scrollIntoView({ block: "end" });
  }, [approvalRevision, chat.messages]);
  const pendingInitialMessage =
    controller.pendingInitialMessage?.botId === bot.id &&
    !chat.messages.some((message) => message.id === initialMessageId)
      ? controller.pendingInitialMessage.text
      : null;
  const busy =
    chat.isStreaming ||
    chat.isRecovering ||
    chat.isToolContinuation ||
    chat.status === "submitted" ||
    Boolean(pendingInitialMessage);
  const composerBusy = busy || controller.sending;
  const connectionError = chat.connectionError?.message ?? agent.connectionError?.message ?? "";
  const teammateActive = busy || bot.status === "working" || bot.status === "needs_approval";
  const lastMessage = chat.messages.at(-1);
  const lastAssistantHasOutput =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.some((part) => {
      if (part.type === "text" || part.type === "reasoning")
        return "text" in part && Boolean(part.text?.trim());
      return part.type.startsWith("tool-") || part.type === "dynamic-tool";
    });
  const showThinking = Boolean(pendingInitialMessage) || (busy && !lastAssistantHasOutput);
  const loadingEmpty =
    chat.messages.length === 0 &&
    !pendingInitialMessage &&
    approvals.length === 0 &&
    (chat.status !== "ready" || chat.isRecovering);
  async function send(): Promise<void> {
    const text = prompt.trim();
    if (!text || composerBusy) return;
    setLocalError("");
    controller.setError("");
    try {
      const transfer = new DataTransfer();
      for (const item of files) transfer.items.add(item.file);
      await chat.sendMessage({ text, files: files.length > 0 ? transfer.files : undefined });
      setFiles([]);
      onPromptChange("");
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "The message could not be sent");
    }
  }
  function upload(event: ChangeEvent<HTMLInputElement>): void {
    const selected = [...(event.target.files ?? [])];
    event.target.value = "";
    const invalid = selected.find((file) => file.size === 0 || file.size > 10_000_000);
    if (invalid) {
      setLocalError("Files must contain 1 byte to 10 MB");
      return;
    }
    setLocalError("");
    setFiles((current) =>
      [
        ...current,
        ...selected.map((file) => ({ file, id: crypto.randomUUID(), name: file.name }))
      ].slice(0, 5)
    );
  }
  async function resolveApproval(approval: PendingAction, approved: boolean): Promise<void> {
    setResolving(approval.executionId);
    setLocalError("");
    try {
      if (approved) await agent.stub.approveIntegrationAction(approval.executionId);
      else await agent.stub.rejectIntegrationAction(approval.executionId, approval.seq);
      await refreshApprovals();
      await controller.load(bot.id);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "The approval could not be recorded");
    } finally {
      setResolving(null);
    }
  }
  async function stop(): Promise<void> {
    setLocalError("");
    try {
      await Promise.all([chat.stop(), controller.stopSelectedBot()]);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "The teammate could not be stopped");
    }
  }
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-reader">
      <ConversationHeader
        bot={bot}
        showBack={showBack}
        status={
          chat.isRecovering
            ? "Recovering"
            : bot.status === "needs_approval"
              ? "Needs approval"
              : teammateActive
                ? "Working"
                : connectionError
                  ? "Offline"
                  : "Live"
        }
        working={teammateActive}
        onBack={() => controller.setMobileChatOpen(false)}
        onDetails={() => controller.setDetailsOpen(true)}
        onEdit={() => controller.setDialog("profile")}
        onStop={() => void stop()}
      />
      <div className="min-h-0 flex-1 overflow-y-auto bg-card/30">
        <div
          aria-label={`Conversation with ${bot.name}`}
          aria-relevant="additions"
          className="mx-auto flex w-full max-w-[780px] flex-col gap-7 px-4 py-8 sm:px-8"
          role="log"
        >
          {loadingEmpty ? (
            <div className="my-auto flex min-h-56 items-center justify-center text-center">
              <p className="text-sm text-muted-foreground">Loading conversation…</p>
            </div>
          ) : null}
          {!loadingEmpty &&
          chat.messages.length === 0 &&
          !pendingInitialMessage &&
          approvals.length === 0 ? (
            <div className="my-auto flex min-h-56 flex-col items-center justify-center text-center">
              <p className="text-sm font-medium text-foreground">Start a conversation</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Send a message to {bot.name} below.
              </p>
            </div>
          ) : null}
          {pendingInitialMessage ? (
            <AgentMessage
              name="You"
              parts={[{ text: pendingInitialMessage, type: "text" }]}
              speaker="user"
            />
          ) : null}
          {chat.messages.map((message) =>
            message.role === "user" || message.role === "assistant" ? (
              <AgentMessage
                key={message.id}
                name={message.role === "user" ? "You" : bot.name}
                parts={message.parts as unknown as AgentPart[]}
                speaker={message.role}
              />
            ) : null
          )}
          {showThinking ? (
            <ThinkingIndicator name={bot.name} recovering={chat.isRecovering} />
          ) : null}
          {approvals.map((approval) => (
            <ApprovalCard
              description={`${approval.connector} requested ${approval.method}. Review the exact input before you approve it.`}
              details={integrationActionDetails(approval)}
              key={`${approval.executionId}:${approval.seq}`}
              pending={resolving === approval.executionId}
              title="Connected-service approval"
              onApprove={() => void resolveApproval(approval, true)}
              onDeny={() => void resolveApproval(approval, false)}
            />
          ))}
          <div ref={endRef} />
        </div>
      </div>
      <div className="shrink-0 bg-gradient-to-t from-reader via-reader to-reader/80 pt-2">
        <ChatComposer
          attachedFiles={files}
          bot={bot}
          error={localError || chat.error?.message || connectionError || controller.error}
          prompt={prompt}
          sending={composerBusy}
          teammates={controller.snapshot?.bots ?? []}
          uploading={false}
          onConnect={() => controller.setDialog("connection")}
          onPromptChange={onPromptChange}
          onRemoveFile={(file) =>
            setFiles((current) => current.filter((item) => item.id !== file.id))
          }
          onSend={() => void send()}
          onUpload={upload}
        />
      </div>
    </section>
  );
}
