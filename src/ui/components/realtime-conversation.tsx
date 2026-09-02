import type { PendingAction } from "@cloudflare/codemode";
import { useAgentChat } from "@cloudflare/think/react";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import {
  type ChangeEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type { BotTeammate } from "../../domain/types";
import { useInitialMessageDelivery } from "../hooks/use-initial-message-delivery";
import type { WorkspaceController } from "../hooks/use-workspace";
import { artifactReferences, uploadArtifacts } from "../lib/artifact-upload";
import { integrationActionDetails, type TeammateIntegrationClient } from "../lib/mcp";
import { AgentMessage, type AgentPart, ThinkingIndicator } from "./chat/agent-message";
import { ApprovalCard } from "./chat/approval-card";
import { ChatComposer, type ComposerFile } from "./chat/chat-composer";
import { Shimmer } from "./chat/shimmer";
import { ConversationHeader } from "./conversation-header";

type LocalFile = ComposerFile & { file: File };
const STREAM_PAUSE_MS = 700;

const MemoizedAgentMessage = memo(AgentMessage);

function isInternalContinuation(message: UIMessage): boolean {
  if (message.role !== "user") return false;
  const metadata = message.metadata as { turnMetadata?: { source?: unknown } } | null | undefined;
  return metadata?.turnMetadata?.source === "active-task";
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
  const agent = useAgent<TeammateIntegrationClient, unknown>({
    agent: "HQBOT_TEAMMATE",
    name: bot.id
  });
  const chat = useAgentChat({
    agent,
    credentials: "include",
    throttle: 50
  });
  const [approvals, setApprovals] = useState<PendingAction[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [admitting, setAdmitting] = useState(false);
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState("");
  const [pausedStreamText, setPausedStreamText] = useState<string | null>(null);
  const activeSendRef = useRef<Promise<void> | null>(null);
  const admittingRef = useRef(false);
  const visibleMessages = useMemo(
    () => chat.messages.filter((message) => !isInternalContinuation(message)),
    [chat.messages]
  );
  const messageIds = useMemo(() => chat.messages.map((message) => message.id), [chat.messages]);
  const conversationRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const promptRef = useRef(prompt);
  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);
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
  const pendingInitialMessage = useInitialMessageDelivery({
    botId: bot.id,
    controller,
    messageIds,
    onError: setLocalError,
    onPromptChange,
    ready: agent.ready
  });
  const busy =
    chat.isStreaming ||
    chat.isRecovering ||
    chat.isToolContinuation ||
    chat.status === "submitted" ||
    Boolean(pendingInitialMessage);
  const connectionError = chat.connectionError?.message ?? agent.connectionError?.message ?? "";
  const teammateActive =
    busy || admitting || bot.status === "working" || bot.status === "needs_approval";
  const lastMessage = visibleMessages.at(-1);
  const lastAssistantParts =
    lastMessage?.role === "assistant" ? (lastMessage.parts as AgentPart[]) : [];
  const lastAssistantText = lastAssistantParts
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => part.text ?? "")
    .join("\n");
  const lastAssistantHasOutput =
    Boolean(lastAssistantText.trim()) ||
    lastAssistantParts.some(
      (part) => part.type.startsWith("tool-") || part.type === "dynamic-tool"
    );
  const lastAssistantIsReasoning = lastAssistantParts.some(
    (part) => part.type === "reasoning" && part.state === "streaming"
  );
  const lastAssistantHasActiveTool = lastAssistantParts.some(
    (part) =>
      (part.type.startsWith("tool-") || part.type === "dynamic-tool") &&
      part.output === undefined &&
      part.state !== "output-available" &&
      part.state !== "output-error"
  );
  const waitingForNextPart =
    (busy || admitting) &&
    lastAssistantHasOutput &&
    !lastAssistantIsReasoning &&
    !lastAssistantHasActiveTool;
  useEffect(() => {
    if (!waitingForNextPart) {
      setPausedStreamText(null);
      return;
    }
    setPausedStreamText(null);
    const timeout = window.setTimeout(
      () => setPausedStreamText(lastAssistantText),
      STREAM_PAUSE_MS
    );
    return () => window.clearTimeout(timeout);
  }, [lastAssistantText, waitingForNextPart]);
  const streamPaused = pausedStreamText !== null && pausedStreamText === lastAssistantText;
  const backgroundLabel =
    !busy && bot.status === "working"
      ? controller.selectedTask?.workState === "waiting" && !controller.selectedTask.wakeAt
        ? "Bash is running"
        : ["scheduled", "running"].includes(controller.selectedTask?.workState ?? "")
          ? "Bash finished — resuming agent"
          : null
      : null;
  const showThinking =
    Boolean(pendingInitialMessage) ||
    ((busy || admitting) &&
      (!lastAssistantHasOutput || lastAssistantIsReasoning || streamPaused)) ||
    Boolean(backgroundLabel);
  const loadingEmpty =
    visibleMessages.length === 0 &&
    !pendingInitialMessage &&
    approvals.length === 0 &&
    (chat.status !== "ready" || chat.isRecovering);
  useLayoutEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation || !followLatestRef.current) return;
    conversation.scrollTop = Math.max(0, conversation.scrollHeight - conversation.clientHeight);
  });
  async function send(): Promise<void> {
    const text = prompt.trim();
    if (!text || controller.sending || admittingRef.current) return;
    admittingRef.current = true;
    followLatestRef.current = true;
    setAdmitting(true);
    const pendingFiles = files;
    promptRef.current = "";
    onPromptChange("");
    setFiles([]);
    setOptimisticMessage(text);
    setLocalError("");
    controller.setError("");
    try {
      const uploaded = await uploadArtifacts(
        bot.id,
        pendingFiles.map((item) => item.file)
      );
      const artifacts = artifactReferences(uploaded);
      const message: Omit<UIMessage, "id" | "role"> = {
        parts: [
          { type: "text", text },
          ...(artifacts.length > 0 ? [{ type: "data-artifacts" as const, data: artifacts }] : [])
        ]
      };
      if (busy || activeSendRef.current) {
        await chat.stop();
        await activeSendRef.current?.catch(() => undefined);
        if (uploaded.length === 0) {
          const result = await agent.stub.submitChat({
            prompt: text,
            submissionId: `steer:${crypto.randomUUID()}`
          });
          if (!result) throw new Error("The follow-up was stopped before it started");
          if (!result.accepted)
            throw new Error(result.error ?? `The follow-up could not start (${result.status})`);
          setOptimisticMessage(null);
          void controller.load(bot.id);
          return;
        }
      }
      const response = chat.sendMessage(message, {
        body: { artifactIds: uploaded.map((file) => file.id) }
      });
      activeSendRef.current = response;
      setOptimisticMessage(null);
      void response
        .catch((cause) => {
          if (!promptRef.current) {
            promptRef.current = text;
            onPromptChange(text);
          }
          setFiles((current) => (current.length === 0 ? pendingFiles : current));
          setLocalError(cause instanceof Error ? cause.message : "The message could not be sent");
        })
        .finally(() => {
          if (activeSendRef.current === response) activeSendRef.current = null;
        });
    } catch (cause) {
      setOptimisticMessage(null);
      if (!promptRef.current) {
        promptRef.current = text;
        onPromptChange(text);
      }
      setFiles((current) => (current.length === 0 ? pendingFiles : current));
      setLocalError(cause instanceof Error ? cause.message : "The message could not be sent");
    } finally {
      admittingRef.current = false;
      setAdmitting(false);
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
        onStop={() => void stop()}
      />
      <div
        className="hqbot-conversation-surface min-h-0 flex-1 overflow-y-auto"
        ref={conversationRef}
        onScroll={(event) => {
          const conversation = event.currentTarget;
          followLatestRef.current =
            conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 96;
        }}
      >
        <div
          aria-label={`Conversation with ${bot.name}`}
          aria-relevant="additions"
          className="mx-auto flex w-full max-w-[840px] flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10"
          role="log"
        >
          {loadingEmpty ? (
            <div className="my-auto flex min-h-56 items-center justify-center text-center">
              <Shimmer className="text-sm">Loading conversation…</Shimmer>
            </div>
          ) : null}
          {!loadingEmpty &&
          visibleMessages.length === 0 &&
          !pendingInitialMessage &&
          !optimisticMessage &&
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
          {optimisticMessage ? (
            <AgentMessage
              name="You"
              parts={[{ text: optimisticMessage, type: "text" }]}
              speaker="user"
            />
          ) : null}
          {visibleMessages.map((message) =>
            message.role === "user" || message.role === "assistant" ? (
              <MemoizedAgentMessage
                key={message.id}
                name={message.role === "user" ? "You" : bot.name}
                parts={message.parts as unknown as AgentPart[]}
                speaker={message.role}
              />
            ) : null
          )}
          {showThinking ? (
            <ThinkingIndicator
              label={backgroundLabel ?? undefined}
              name={bot.name}
              recovering={chat.isRecovering}
            />
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
        </div>
      </div>
      <div className="shrink-0 bg-gradient-to-t from-reader via-reader to-reader/80 pt-2">
        <ChatComposer
          attachedFiles={files}
          bot={bot}
          error={localError || chat.error?.message || connectionError || controller.error}
          prompt={prompt}
          sending={controller.sending || admitting}
          uploading={admitting}
          working={teammateActive}
          onConnect={() => controller.setDialog("connection")}
          onPromptChange={onPromptChange}
          onRemoveFile={(file) =>
            setFiles((current) => current.filter((item) => item.id !== file.id))
          }
          onSend={() => void send()}
          onStop={() => void stop()}
          onUpload={upload}
        />
      </div>
    </section>
  );
}
