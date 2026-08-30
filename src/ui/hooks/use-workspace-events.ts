import { useEffect, useState } from "react";

import type { RealtimeStatus, WorkspaceEvent } from "../types";

export function useWorkspaceEvents({
  onEvent,
  url
}: {
  onEvent: (event: WorkspaceEvent) => void;
  url: string | null;
}): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(url ? "connecting" : "unavailable");

  useEffect(() => {
    if (!url) {
      setStatus("unavailable");
      return;
    }
    const realtimeUrl = url;

    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let retryCount = 0;
    let stopped = false;

    function connect(): void {
      if (stopped) return;
      setStatus("connecting");
      socket = new WebSocket(new URL(realtimeUrl, window.location.href));
      socket.addEventListener("open", () => {
        retryCount = 0;
        setStatus("connected");
      });
      socket.addEventListener("message", (message) => {
        if (typeof message.data !== "string") return;
        try {
          onEvent(JSON.parse(message.data) as WorkspaceEvent);
        } catch {
          // Ignore frames from a newer server until the UI understands them.
        }
      });
      socket.addEventListener("close", () => {
        if (stopped) return;
        setStatus("connecting");
        const delay = Math.min(30_000, 1_000 * 2 ** retryCount);
        retryCount += 1;
        retryTimer = window.setTimeout(connect, delay);
      });
    }

    connect();
    return () => {
      stopped = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [onEvent, url]);

  return status;
}
