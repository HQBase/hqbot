import { useEffect, useRef } from "react";
import { PiCaretDown, PiGauge } from "react-icons/pi";

import { errorMessage } from "../../lib/api";
import { currency } from "../../lib/format";

export interface ComputerResources {
  cpuPercent: number | null;
  diskBytes: number | null;
  diskLimitBytes?: number | null;
  estimatedCostUsd: number | null;
  memoryBytes: number | null;
  memoryLimitBytes?: number | null;
  updatedAt?: string | null;
  uptimeSeconds: number | null;
}

export interface ComputerStatus {
  ownerControl: boolean;
  resources: ComputerResources | null;
  running: boolean;
}

function socketUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function ComputerScreen({
  interactive,
  onDisconnect,
  onError,
  onLive,
  webSocketPath
}: {
  interactive: boolean;
  onDisconnect: () => void;
  onError: (message: string) => void;
  onLive: () => void;
  webSocketPath: string;
}) {
  const target = useRef<HTMLDivElement>(null);
  const connection = useRef<{ disconnect(): void; viewOnly: boolean } | null>(null);
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  useEffect(() => {
    let active = true;

    void import("@novnc/novnc")
      .then(({ default: RFB }) => {
        if (!active || !target.current) return;
        const rfb = new RFB(target.current, socketUrl(webSocketPath), { shared: true });
        connection.current = rfb;
        rfb.background = "hsl(var(--background))";
        rfb.compressionLevel = 2;
        rfb.focusOnClick = true;
        rfb.qualityLevel = 5;
        rfb.scaleViewport = true;
        rfb.viewOnly = !interactiveRef.current;
        rfb.addEventListener("connect", onLive, { once: true });
        rfb.addEventListener("disconnect", () => {
          if (active) {
            onDisconnect();
            onError("The computer disconnected");
          }
        });
        rfb.addEventListener("securityfailure", () => {
          if (active) onError("The computer could not make a secure connection");
        });
      })
      .catch((cause) => {
        if (active) onError(errorMessage(cause, "The computer could not open"));
      });

    return () => {
      active = false;
      connection.current?.disconnect();
      connection.current = null;
    };
  }, [onDisconnect, onError, onLive, webSocketPath]);

  useEffect(() => {
    if (connection.current) connection.current.viewOnly = !interactive;
  }, [interactive]);

  return (
    <div
      aria-label={interactive ? "Interactive Linux computer" : "Linux computer, view only"}
      className="size-full overflow-hidden bg-background [&>div]:size-full"
      ref={target}
      role="application"
    />
  );
}

export function ComputerResourceGrid({
  resources,
  running
}: {
  resources: ComputerResources | null;
  running: boolean;
}) {
  return (
    <details className="group mt-3 border-t border-divider pt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-[10px] text-muted-foreground outline-none transition-colors marker:hidden hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
        <PiGauge aria-hidden="true" className="size-3.5" />
        <span className="min-w-0 flex-1 text-left">Computer resources</span>
        <span>{running ? "Live" : "Off"}</span>
        <PiCaretDown
          aria-hidden="true"
          className="size-3 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <p className="mb-2 mt-1 text-[10px] text-muted-foreground">
        {running ? "Updates every 15 sec" : "Available while running"}
      </p>
      <div className="grid grid-cols-2 gap-1.5 pb-1">
        <ResourceMetric label="CPU" value={formatPercent(resources?.cpuPercent)} />
        <ResourceMetric
          label="Memory"
          value={formatUsage(resources?.memoryBytes, resources?.memoryLimitBytes)}
        />
        <ResourceMetric
          label="Disk"
          value={formatUsage(resources?.diskBytes, resources?.diskLimitBytes)}
        />
        <ResourceMetric label="Uptime" value={formatUptime(resources?.uptimeSeconds)} />
        <ResourceMetric
          className="col-span-2"
          label="Estimated computer cost"
          value={resources?.estimatedCostUsd == null ? "—" : currency(resources.estimatedCostUsd)}
        />
      </div>
    </details>
  );
}

function ResourceMetric({
  className = "",
  label,
  value
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={`rounded-md bg-muted px-2.5 py-2 ${className}`}>
      <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <strong className="mt-0.5 block truncate text-[11px] font-medium tabular-nums text-foreground">
        {value}
      </strong>
    </div>
  );
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function formatUsage(value: number | null | undefined, limit: number | null | undefined): string {
  if (value == null) return "—";
  return limit == null ? formatBytes(value) : `${formatBytes(value)} / ${formatBytes(limit)}`;
}

function formatBytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1_024 && unit < units.length - 1) {
    amount /= 1_024;
    unit += 1;
  }
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

function formatUptime(value: number | null | undefined): string {
  if (value == null) return "—";
  const minutes = Math.floor(Math.max(0, value) / 60);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
