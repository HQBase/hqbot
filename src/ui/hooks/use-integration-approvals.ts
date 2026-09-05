import { useCallback, useEffect, useRef, useState } from "react";
import type { IntegrationApproval } from "../../domain/actions";

export function useIntegrationApprovals(input: {
  botId: string;
  botStatus: string;
  chatStatus: string;
  ready: Promise<unknown>;
  stub: { listIntegrationApprovals(): Promise<IntegrationApproval[]> };
}) {
  const { botId, botStatus, chatStatus, ready, stub } = input;
  const [saved, setSaved] = useState<{ botId: string; values: IntegrationApproval[] }>({
    botId,
    values: []
  });
  const request = useRef(0);
  const refreshApprovals = useCallback(async () => {
    const version = ++request.current;
    try {
      await ready;
      if (version !== request.current) return;
      const next = await stub.listIntegrationApprovals();
      if (version === request.current) setSaved({ botId, values: next });
    } catch {
      // A pending approval or reconnect retries this read without repeating the action.
    }
  }, [botId, ready, stub]);
  useEffect(() => {
    if (chatStatus !== "ready" && botStatus !== "needs_approval") return;
    void refreshApprovals();
    const timer =
      botStatus === "needs_approval"
        ? window.setInterval(() => void refreshApprovals(), 5_000)
        : undefined;
    return () => {
      request.current++;
      window.clearInterval(timer);
    };
  }, [botStatus, chatStatus, refreshApprovals]);
  return { approvals: saved.botId === botId ? saved.values : [], refreshApprovals };
}
