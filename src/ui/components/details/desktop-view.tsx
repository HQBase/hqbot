import { useCallback, useEffect, useRef, useState } from "react";
import { PiArrowsOut, PiDesktopTower } from "react-icons/pi";

import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { ComputerResourceGrid, ComputerScreen, type ComputerStatus } from "./computer-parts";
import { DetailsSection } from "./details-section";

const emptyStatus: ComputerStatus = {
  ownerControl: false,
  resources: null,
  running: false
};

export function DesktopView({ active = false, botId }: { active?: boolean; botId: string }) {
  const endpoint = `/api/bots/${encodeURIComponent(botId)}/desktop`;
  const previousActive = useRef(active);
  const refreshPending = useRef(false);
  const [computer, setComputer] = useState<ComputerStatus>(emptyStatus);
  const [screenStatus, setScreenStatus] = useState("idle");
  const [webSocketPath, setWebSocketPath] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const onLive = useCallback(() => {
    setError("");
    setScreenStatus("live");
  }, []);
  const onError = useCallback((message: string) => {
    setError(message);
    setScreenStatus("error");
  }, []);
  const releaseOwnerControl = useCallback(() => {
    setComputer((current) => ({ ...current, ownerControl: false }));
    void api<ComputerStatus>(endpoint, {
      method: "PATCH",
      body: JSON.stringify({ ownerControl: false })
    }).catch(() => undefined);
  }, [endpoint]);

  const applyStatus = useCallback(
    (status: ComputerStatus) => {
      setComputer(status);
      if (status.running) {
        setWebSocketPath((path) => path ?? `${endpoint}/ws`);
        setScreenStatus((current) => (current === "live" ? current : "connecting"));
      } else {
        setWebSocketPath(null);
        setScreenStatus("idle");
      }
    },
    [endpoint]
  );

  const refresh = useCallback(
    async (quiet = false) => {
      if (refreshPending.current) return;
      refreshPending.current = true;
      try {
        const status = await api<ComputerStatus>(endpoint);
        applyStatus(status);
        if (!quiet || !status.running) setError("");
      } catch (cause) {
        if (!quiet) onError(errorMessage(cause, "The computer status could not load"));
      } finally {
        refreshPending.current = false;
        if (!quiet) setLoading(false);
      }
    },
    [applyStatus, endpoint, onError]
  );
  const handleDisconnect = useCallback(() => {
    setWebSocketPath(null);
  }, []);

  useEffect(() => {
    setComputer(emptyStatus);
    setWebSocketPath(null);
    setScreenStatus("idle");
    setMaximized(false);
    setLoading(true);
    setError("");
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (previousActive.current !== active) {
      previousActive.current = active;
      void refresh(true);
    }
    const interval = window.setInterval(() => void refresh(true), active ? 1_000 : 15_000);
    return () => window.clearInterval(interval);
  }, [active, refresh]);

  useEffect(() => {
    if (!computer.ownerControl || !computer.running) return;
    let active = true;
    const interval = window.setInterval(() => {
      void api<ComputerStatus>(endpoint, {
        method: "PATCH",
        body: JSON.stringify({ ownerControl: true })
      })
        .then((status) => active && applyStatus(status))
        .catch((cause) => {
          if (!active) return;
          releaseOwnerControl();
          onError(errorMessage(cause, "Computer control was lost"));
        });
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [
    applyStatus,
    computer.ownerControl,
    computer.running,
    endpoint,
    onError,
    releaseOwnerControl
  ]);

  const badge = error
    ? "Issue"
    : computer.ownerControl
      ? "Owner control"
      : screenStatus === "live"
        ? "Live"
        : computer.running
          ? "Starting"
          : "Off";

  function computerSurface(large = false) {
    const showScreen = Boolean(webSocketPath && (large || !maximized));
    return (
      <div
        className={
          large
            ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-divider bg-background max-lg:rounded-none max-lg:border-x-0"
            : "overflow-hidden rounded-lg border border-divider bg-background"
        }
      >
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-divider bg-muted px-2.5 text-[10px] text-muted-foreground">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${computer.running ? "bg-success" : "bg-tertiary"}`}
          />
          <span className="min-w-0 flex-1 truncate">
            {computer.ownerControl
              ? "Agent actions paused · you have control"
              : "Shared Linux desktop"}
          </span>
          {computer.running ? <span className="tabular-nums">Ubuntu</span> : null}
          {!large ? (
            <DialogTrigger asChild>
              <Button
                aria-label="Maximize computer"
                className="size-6 min-h-6 min-w-6"
                disabled={!webSocketPath}
                size="icon"
                type="button"
                variant="ghost"
              >
                <PiArrowsOut />
              </Button>
            </DialogTrigger>
          ) : null}
        </div>
        <div
          className={large ? "relative min-h-0 flex-1 bg-list" : "relative aspect-[16/10] bg-list"}
        >
          {showScreen && webSocketPath ? (
            <ComputerScreen
              interactive={computer.ownerControl}
              onDisconnect={handleDisconnect}
              onError={onError}
              onLive={onLive}
              webSocketPath={webSocketPath}
            />
          ) : !webSocketPath ? (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              {loading ? <Spinner className="size-7" /> : <PiDesktopTower className="size-7" />}
              <strong className="text-xs font-medium text-foreground">
                The agent starts this computer
              </strong>
              <p className="max-w-52 text-[11px] leading-4">
                The live screen appears here when the teammate uses Bash, Chrome, or another Linux
                app.
              </p>
            </div>
          ) : null}
          {screenStatus === "connecting" && showScreen ? (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-divider bg-background/90 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur-sm">
              <Spinner /> Connecting to the computer…
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function computerStatus(large = false) {
    return (
      <div
        className={
          large
            ? "flex shrink-0 flex-wrap items-center justify-between gap-2 max-lg:px-4 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))] max-lg:pt-3"
            : "mt-3 flex flex-wrap items-center justify-between gap-2"
        }
      >
        <p aria-live="polite" className="min-w-40 flex-1 text-[11px] text-muted-foreground">
          {error ||
            (computer.ownerControl
              ? "You have control. Tell the agent when you are done."
              : computer.running
                ? "View only. Ask the agent if you need control."
                : "The agent starts the computer when work needs it.")}
        </p>
      </div>
    );
  }

  return (
    <Dialog open={maximized} onOpenChange={setMaximized}>
      <DetailsSection badge={badge} defaultOpen icon={PiDesktopTower} title="Computer">
        <p className="mb-3 text-xs leading-5 text-muted-foreground">
          The agent uses one private Linux Sandbox for Bash, Chrome, and other GUI apps. Its live
          screen appears automatically.
        </p>
        {computerSurface()}
        {computerStatus()}
        <ComputerResourceGrid resources={computer.resources} running={computer.running} />
      </DetailsSection>
      <DialogContent className="flex h-[min(92dvh,900px)] w-[min(96vw,1440px)] max-w-none flex-col gap-3 overflow-hidden p-3 sm:p-4 max-lg:left-0 max-lg:top-0 max-lg:h-dvh max-lg:w-screen max-lg:translate-x-0 max-lg:translate-y-0 max-lg:gap-0 max-lg:rounded-none max-lg:border-0 max-lg:p-0">
        <DialogHeader className="shrink-0 pr-12 max-lg:px-4 max-lg:py-3">
          <DialogTitle className="text-sm">Linux computer</DialogTitle>
          <DialogDescription className="sr-only">
            The live Linux desktop for this teammate.
          </DialogDescription>
        </DialogHeader>
        {computerSurface(true)}
        {computerStatus(true)}
      </DialogContent>
    </Dialog>
  );
}
