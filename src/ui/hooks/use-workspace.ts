import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BotRoutine, BotTeammate } from "../../domain/types";
import { api, errorMessage } from "../lib/api";
import type { DialogName, WorkspaceEvent, WorkspaceView } from "../types";
import { useWorkspaceEvents } from "./use-workspace-events";

export async function createTeammate(message: string): Promise<BotTeammate> {
  const created = await api<{ teammate: BotTeammate }>("/api/bots", {
    method: "POST",
    body: JSON.stringify({ brief: message.slice(0, 2_000), conversation: true })
  });
  return created.teammate;
}

export async function submitInitialMessage(botId: string, message: string): Promise<void> {
  const submit = () =>
    api(`/api/bots/${botId}/messages/initial`, {
      method: "POST",
      body: JSON.stringify({ prompt: message })
    });
  try {
    await submit();
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    await submit();
  }
}

export function useWorkspace(onSignedOut: () => void) {
  const [snapshot, setSnapshot] = useState<WorkspaceView | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [pendingInitialMessage, setPendingInitialMessage] = useState<{
    botId: string;
    text: string;
  } | null>(null);
  const [newTeammate, setNewTeammate] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
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
      setLoadError("");
    } catch (cause) {
      setLoadError(errorMessage(cause, "HQBot could not load"));
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
    setError("");
    selectedBotRef.current = bot.id;
    newTeammateRef.current = false;
    setSelectedBotId(bot.id);
    setNewTeammate(false);
    setMobileChatOpen(true);
    if (window.matchMedia("(max-width: 1023px)").matches) setDetailsOpen(false);
    void load(bot.id);
  }

  function beginNewTeammate(): void {
    setError("");
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
    let createdTeammate: BotTeammate | null = null;
    try {
      createdTeammate = await createTeammate(value);
      await submitInitialMessage(createdTeammate.id, value);
      setPendingInitialMessage({ botId: createdTeammate.id, text: value });
      selectedBotRef.current = createdTeammate.id;
      newTeammateRef.current = false;
      setSelectedBotId(createdTeammate.id);
      setNewTeammate(false);
      await load(createdTeammate.id);
      return true;
    } catch (cause) {
      if (createdTeammate) {
        selectedBotRef.current = createdTeammate.id;
        newTeammateRef.current = false;
        setSelectedBotId(createdTeammate.id);
        setNewTeammate(false);
        await load(createdTeammate.id);
      }
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
    error: error || loadError,
    load,
    logout,
    mobileChatOpen,
    newTeammate,
    pendingInitialMessage,
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
