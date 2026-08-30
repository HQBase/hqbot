import type { PendingApproval } from "@cloudflare/think";
import { useAgentChat } from "@cloudflare/think/react";
import { useAgent } from "agents/react";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import type { BotTeammate } from "../../domain/types";
import type { WorkspaceController } from "../hooks/use-workspace";
import { AgentMessage, type AgentPart } from "./chat/agent-message";
import { ApprovalCard } from "./chat/approval-card";
import { ChatComposer, type ComposerFile } from "./chat/chat-composer";
import { ConversationHeader } from "./conversation-header";

interface TeammateAgentClient {
  readonly state: unknown;
  approveExecution(executionId: string): Promise<unknown>;
  pendingApprovals(executionId?: string): Promise<PendingApproval[]>;
  rejectExecution(executionId: string, reason?: string): Promise<unknown>;
}

type LocalFile = ComposerFile & { file: File };

export function replyDraft(approval: PendingApproval): string | null {
  if (approval.source !== "action" || approval.descriptor.action !== "send_hqbase_reply")
    return null;
  const input = approval.descriptor.input;
  if (!input || typeof input !== "object") return null;
  const draft = (input as Record<string, unknown>).draft;
  return typeof draft === "string" && draft.length > 0 ? draft : null;
}

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
  const agent = useAgent<TeammateAgentClient, unknown>({
    agent: "HQBOT_TEAMMATE",
    name: bot.id
  });
  const chat = useAgentChat({ agent, credentials: "include", throttle: 50 });
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [localError, setLocalError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const refreshApprovals = useCallback(async () => {
    try {
      setApprovals(await agent.stub.pendingApprovals());
    } catch {
      // A reconnect or terminal close will retry when chat becomes ready.
    }
  }, [agent.stub]);

  useEffect(() => {
    if (chat.status !== "ready") return;
    void refreshApprovals();
    void controller.load(bot.id);
  }, [bot.id, chat.status, controller.load, refreshApprovals]);

  const lastMessageId = chat.messages.at(-1)?.id;
  const approvalRevision = approvals.map((approval) => approval.executionId).join(":");
  useEffect(() => {
    if (lastMessageId || approvalRevision) endRef.current?.scrollIntoView({ block: "end" });
  }, [approvalRevision, lastMessageId]);

  const busy = chat.isStreaming || chat.isRecovering || chat.status === "submitted";
  const connectionError = chat.connectionError?.message ?? agent.connectionError?.message ?? "";

  async function send(): Promise<void> {
    const text = prompt.trim();
    if (!text || busy) return;
    setLocalError("");
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

  async function resolveApproval(approval: PendingApproval, approved: boolean): Promise<void> {
    setResolving(approval.executionId);
    setLocalError("");
    try {
      if (approved) await agent.stub.approveExecution(approval.executionId);
      else await agent.stub.rejectExecution(approval.executionId, "The owner kept this as a draft");
      await refreshApprovals();
      await controller.load(bot.id);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "The approval could not be recorded");
    } finally {
      setResolving(null);
    }
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-reader">
      <ConversationHeader
        bot={bot}
        detailsOpen={controller.detailsOpen}
        showBack={showBack}
        status={
          chat.isRecovering ? "Recovering" : busy ? "Working" : connectionError ? "Offline" : "Live"
        }
        working={busy}
        onBack={() => controller.setMobileChatOpen(false)}
        onDetails={() => controller.setDetailsOpen(!controller.detailsOpen)}
        onEdit={() => controller.setDialog("profile")}
        onStop={() => void chat.stop()}
      />
      <div className="min-h-0 flex-1 overflow-y-auto bg-card/30">
        <div className="mx-auto flex w-full max-w-[780px] flex-col gap-7 px-4 py-8 sm:px-8">
          <AgentMessage
            name={bot.name}
            parts={[{ text: bot.description || "What can I help with?", type: "text" }]}
            speaker="assistant"
          />
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
          {approvals.map((approval) => (
            <ApprovalCard
              description={approval.descriptor.summary}
              draft={replyDraft(approval)}
              key={approval.executionId}
              pending={resolving === approval.executionId}
              title={
                approval.descriptor.risk === "high" ? "Approval required" : "Review this action"
              }
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
          sending={busy}
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
