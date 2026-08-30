import { useAgent } from "agents/react";
import { useEffect, useState } from "react";
import { PiArrowSquareOut, PiGlobe, PiMonitor, PiStop } from "react-icons/pi";

import type { BotTask, ComputerState } from "../../../domain/types";
import { useArtifactUrl } from "../../hooks/use-artifact-url";
import { Button } from "../ui/button";
import { DetailsSection } from "./details-section";

type LiveComputer = ComputerState & { liveViewUrl?: string };
type LiveViewResult = {
  sessionId: string;
  targets: Array<{ pageUrl?: string; title?: string; url: string }>;
};

interface LiveViewAgent {
  readonly state: unknown;
  closeLiveView(): Promise<void>;
  getLiveView(mode?: "tab" | "devtools"): Promise<LiveViewResult | null>;
  keepLiveViewAlive(sessionId: string, taskId?: string): Promise<boolean>;
}

export function LiveView({
  computer,
  botId,
  task
}: {
  computer: LiveComputer;
  botId: string;
  task: BotTask | null;
}) {
  const agent = useAgent<LiveViewAgent, unknown>({ agent: "HQBOT_TEAMMATE", name: botId });
  const [liveTarget, setLiveTarget] = useState<LiveViewResult["targets"][number] | null>(null);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const screenshotKey = computer.active ? computer.screenshotKey : (task?.screenshotKey ?? null);
  const revision = computer.active ? computer.updatedAt : (task?.updatedAt ?? null);
  const screenshot = useArtifactUrl({ key: screenshotKey, revision });
  const source = liveTarget?.url ?? computer.liveViewUrl ?? null;

  useEffect(() => {
    if (!liveSessionId) return;
    const interval = window.setInterval(() => {
      void agent.stub
        .keepLiveViewAlive(liveSessionId, task?.id)
        .then((alive) => {
          if (!alive) {
            setLiveSessionId(null);
            setLiveTarget(null);
          }
        })
        .catch(() => {
          setError("Live View lost its browser session");
          setLiveSessionId(null);
          setLiveTarget(null);
        });
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [agent.stub, liveSessionId, task?.id]);

  async function openLiveView(): Promise<void> {
    setOpening(true);
    setError("");
    try {
      const result = await agent.stub.getLiveView("tab");
      const target = result?.targets.find((candidate) => !candidate.pageUrl?.startsWith("about:"));
      if (!target) throw new Error("No browser tab is active yet");
      setLiveTarget(target);
      setLiveSessionId(result?.sessionId ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Live View could not open");
    } finally {
      setOpening(false);
    }
  }

  async function stop(): Promise<void> {
    await agent.stub.closeLiveView();
    setLiveTarget(null);
    setLiveSessionId(null);
  }

  return (
    <DetailsSection
      badge={source || computer.active ? "Live" : "Idle"}
      defaultOpen
      icon={PiMonitor}
      title="Shared computer"
    >
      <p className="mb-3 text-xs text-muted-foreground">Cloudflare Browser Run</p>
      <div className="overflow-hidden rounded-lg border border-divider bg-background">
        <div className="flex h-8 items-center gap-2 border-b border-divider bg-muted px-2">
          <span className="flex gap-1" aria-hidden="true">
            <i className="size-1.5 rounded-full bg-tertiary" />
            <i className="size-1.5 rounded-full bg-tertiary" />
            <i className="size-1.5 rounded-full bg-tertiary" />
          </span>
          <span className="min-w-0 flex-1 truncate rounded-md border border-divider bg-background px-2 py-1 text-[10px] text-muted-foreground">
            {liveTarget?.pageUrl ?? computer.url ?? task?.browserUrl ?? "Browser ready"}
          </span>
        </div>
        <div className="aspect-[16/10] bg-list">
          {source ? (
            <iframe className="size-full border-0" src={source} title="Live shared computer" />
          ) : screenshot ? (
            <img
              alt="Shared computer evidence"
              className="size-full object-cover object-top"
              src={screenshot}
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <PiGlobe className="size-7" />
              <strong className="text-xs font-medium text-foreground">Computer ready</strong>
              <p className="max-w-48 text-[11px] leading-4">
                A live view appears when this teammate opens a browser.
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {error || "Live View opens only when you ask"}
        </p>
        <div className="flex gap-1">
          {source || computer.active ? (
            <Button size="sm" type="button" variant="outline" onClick={() => void stop()}>
              <PiStop data-icon="inline-start" /> Stop
            </Button>
          ) : (
            <Button
              disabled={opening}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void openLiveView()}
            >
              <PiMonitor data-icon="inline-start" /> {opening ? "Opening…" : "Open Live View"}
            </Button>
          )}
          {task?.browserUrl ? (
            <Button asChild size="sm" variant="ghost">
              <a href={task.browserUrl} rel="noreferrer" target="_blank">
                <PiArrowSquareOut data-icon="inline-start" /> Source
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </DetailsSection>
  );
}
