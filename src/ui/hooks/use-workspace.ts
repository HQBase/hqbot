import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BotRoutine, BotTeammate } from "../../domain/types";
import { api, errorMessage } from "../lib/api";
import type { DialogName, WorkspaceEvent, WorkspaceView } from "../types";
import { useWorkspaceEvents } from "./use-workspace-events";

export function useWorkspace(onSignedOut: () => void) {
  const [snapshot, setSnapshot] = useState<WorkspaceView | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [newTeammate, setNewTeammate] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const selectedBotRef = useRef<string | null>(null);
  const newTeammateRef = useRef(false);

  const load = useCallback(async (requestedBotId?: string | null) => {
    const botId = requestedBotId === undefined ? selectedBotRef.current : requestedBotId;
    const query = botId ? `?botId=${encodeURIComponent(botId)}` : "";
    try {
      const next = await api<WorkspaceView>(`/api/snapshot${query}`);
      setSnapshot(next);
      if (!newTeammateRef.current) {
        const nextId = next.selectedBot?.id ?? next.bots[0]?.id ?? null;
        selectedBotRef.current = nextId;
        setSelectedBotId(nextId);
      }
      setError("");
    } catch (cause) {
      setError(errorMessage(cause, "HQBot could not load"));
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const onEvent = useCallback(
    (event: WorkspaceEvent) => {
      if (event.type === "snapshot") {
        setSnapshot(event.snapshot);
        return;
      }
      void load();
    },
    [load]
  );
  const realtimeStatus = useWorkspaceEvents({
    onEvent,
    url: snapshot?.realtime?.url ?? null
  });

  const selectedBot = useMemo(
    () =>
      newTeammate
        ? null
        : ([...(snapshot?.bots ?? []), ...(snapshot?.archivedBots ?? [])].find(
            (bot) => bot.id === selectedBotId
          ) ??
          snapshot?.selectedBot ??
          null),
    [newTeammate, selectedBotId, snapshot]
  );
  const selectedTask = newTeammate ? null : (snapshot?.activeTask ?? snapshot?.tasks[0] ?? null);

  function selectBot(bot: BotTeammate): void {
    selectedBotRef.current = bot.id;
    newTeammateRef.current = false;
    setSelectedBotId(bot.id);
    setNewTeammate(false);
    setMobileChatOpen(true);
    if (window.matchMedia("(max-width: 1023px)").matches) setDetailsOpen(false);
    void load(bot.id);
  }

  function beginNewTeammate(): void {
    selectedBotRef.current = null;
    newTeammateRef.current = true;
    setSelectedBotId(null);
    setNewTeammate(true);
    setMobileChatOpen(true);
    if (window.matchMedia("(max-width: 1023px)").matches) setDetailsOpen(false);
  }

  async function send(prompt: string): Promise<boolean> {
    const value = prompt.trim();
    if (!value || sending) return false;
    setSending(true);
    setError("");
    try {
      const created = await api<{ teammate: BotTeammate }>("/api/bots", {
        method: "POST",
        body: JSON.stringify({ brief: value })
      });
      selectedBotRef.current = created.teammate.id;
      newTeammateRef.current = false;
      setSelectedBotId(created.teammate.id);
      setNewTeammate(false);
      await load(created.teammate.id);
      return true;
    } catch (cause) {
      setError(errorMessage(cause, "The message could not be sent"));
      return false;
    } finally {
      setSending(false);
    }
  }

  async function setRoutineActive(routine: BotRoutine, active: boolean): Promise<void> {
    if (!selectedBot) return;
    setError("");
    try {
      await api(`/api/bots/${selectedBot.id}/routines/${routine.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active })
      });
      await load(selectedBot.id);
    } catch (cause) {
      setError(errorMessage(cause, `The routine could not be ${active ? "resumed" : "paused"}`));
    }
  }

  async function deleteRoutine(routine: BotRoutine): Promise<void> {
    if (!selectedBot) return;
    setError("");
    try {
      await api(`/api/bots/${selectedBot.id}/routines/${routine.id}`, { method: "DELETE" });
      await load(selectedBot.id);
    } catch (cause) {
      setError(errorMessage(cause, "The routine could not be deleted"));
    }
  }

  async function restoreSelectedBot(): Promise<void> {
    if (!selectedBot?.hidden) return;
    setError("");
    try {
      await api(`/api/bots/${selectedBot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: false })
      });
      await load(selectedBot.id);
    } catch (cause) {
      setError(errorMessage(cause, "The teammate could not be restored"));
    }
  }

  async function logout(): Promise<void> {
    try {
      await api("/api/auth/logout", { method: "POST" });
      onSignedOut();
    } catch (cause) {
      setError(errorMessage(cause, "HQBot could not sign out"));
    }
  }

  return {
    beginNewTeammate,
    deleteRoutine,
    detailsOpen,
    dialog,
    error,
    load,
    logout,
    mobileChatOpen,
    newTeammate,
    realtimeStatus,
    restoreSelectedBot,
    selectBot,
    selectedBot,
    selectedTask,
    send,
    sending,
    setRoutineActive,
    setDetailsOpen,
    setDialog,
    setError,
    setMobileChatOpen,
    snapshot
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspace>;
