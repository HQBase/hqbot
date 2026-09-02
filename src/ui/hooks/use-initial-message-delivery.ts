import { useEffect, useRef, useState } from "react";

import * as initialMessage from "../lib/initial-message";
import type { WorkspaceController } from "./use-workspace";

export function useInitialMessageDelivery(input: {
  botId: string;
  controller: WorkspaceController;
  messageIds: readonly string[];
  onError: (message: string) => void;
  onPromptChange: (value: string) => void;
  ready: Promise<unknown>;
}): string | null {
  const [retry, setRetry] = useState(0);
  const submissionRef = useRef<string | null>(null);
  const queued = input.controller.pendingInitialMessage?.botId === input.botId;
  const initialMessageId = `chat:first:${input.botId}`;

  useEffect(() => {
    if (!queued) return;
    let active = true;
    let retryTimer: number | undefined;
    const retryLater = () => {
      retryTimer = initialMessage.scheduleInitialMessageRetry(retry, () => {
        submissionRef.current = null;
        setRetry((current) => current + 1);
      });
    };
    void (async () => {
      try {
        await input.ready;
        if (!active || submissionRef.current === input.botId) return;
        const text = input.controller.pendingInitialMessage?.text;
        if (!text) return;
        submissionRef.current = input.botId;
        input.onError("");
        const delivery = await initialMessage.submitInitialMessage(input.botId, text);
        if (active && delivery === "pending") retryLater();
      } catch (cause) {
        if (!active) return;
        if (cause instanceof initialMessage.InitialMessageAdmissionUnknownError) {
          input.onError(cause.message);
          retryLater();
          return;
        }
        submissionRef.current = null;
        setRetry(0);
        const text = input.controller.takePendingInitialMessage(input.botId);
        if (text) input.onPromptChange(text);
        input.onError(cause instanceof Error ? cause.message : "The message could not be sent");
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [
    input.botId,
    input.controller.pendingInitialMessage,
    input.controller.takePendingInitialMessage,
    input.onError,
    input.onPromptChange,
    input.ready,
    queued,
    retry
  ]);

  useEffect(() => {
    if (queued && input.messageIds.includes(initialMessageId)) {
      input.controller.takePendingInitialMessage(input.botId);
      input.onError("");
      setRetry(0);
    }
  }, [
    input.botId,
    input.controller.takePendingInitialMessage,
    input.messageIds,
    input.onError,
    initialMessageId,
    queued
  ]);

  return queued && !input.messageIds.includes(initialMessageId)
    ? (input.controller.pendingInitialMessage?.text ?? null)
    : null;
}
