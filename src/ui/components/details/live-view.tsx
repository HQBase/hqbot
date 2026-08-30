import { useAgent } from "agents/react";
import { useState } from "react";
import { PiArrowSquareOut, PiGlobe, PiMonitor, PiStop } from "react-icons/pi";

import type { BotTask, ComputerState } from "../../../domain/types";
import { useArtifactUrl } from "../../hooks/use-artifact-url";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

type LiveComputer = ComputerState & { liveViewUrl?: string };
type LiveViewResult = {
  targets: Array<{ pageUrl?: string; title?: string; url: string }>;
};

interface LiveViewAgent {
  readonly state: unknown;
  closeLiveView(): Promise<void>;
  getLiveView(mode?: "tab" | "devtools"): Promise<LiveViewResult | null>;
}

export function LiveView({
  computer,
  botId,
  task,
  onStop
}: {
  computer: LiveComputer;
  botId: string;
  task: BotTask | null;
  onStop: () => void;
}) {
  const agent = useAgent<LiveViewAgent, unknown>({ agent: "HQBOT_TEAMMATE", name: botId });
  const [liveTarget, setLiveTarget] = useState<LiveViewResult["targets"][number] | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const screenshotKey = computer.active ? computer.screenshotKey : (task?.screenshotKey ?? null);
  const revision = computer.active ? computer.updatedAt : (task?.updatedAt ?? null);
  const screenshot = useArtifactUrl({ key: screenshotKey, revision });
  const source = liveTarget?.url ?? computer.liveViewUrl ?? null;

  async function openLiveView(): Promise<void> {
    setOpening(true);
    setError("");
    try {
      const result = await agent.stub.getLiveView("tab");
      const target = result?.targets.find((candidate) => !candidate.pageUrl?.startsWith("about:"));
      if (!target) throw new Error("No browser tab is active yet");
      setLiveTarget(target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Live View could not open");
    } finally {
      setOpening(false);
    }
  }

  async function stop(): Promise<void> {
    await agent.stub.closeLiveView();
    setLiveTarget(null);
    onStop();
  }

  return (
    <Card className="overflow-hidden shadow-none">
      <CardHeader className="flex-row items-start justify-between gap-3 p-4 pb-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <PiMonitor /> Shared computer
          </CardTitle>
          <CardDescription className="text-xs">Cloudflare Browser Run</CardDescription>
        </div>
        <Badge variant="outline">{source || computer.active ? "Live" : "Idle"}</Badge>
      </CardHeader>
      <CardContent className="p-3 pt-0">
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
      </CardContent>
    </Card>
  );
}
