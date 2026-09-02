import { useState } from "react";
import type { IconType } from "react-icons";
import { PiCaretDown, PiCheck, PiFile, PiLightbulb, PiSpinnerGap, PiWarning } from "react-icons/pi";
import { Badge } from "../ui/badge";
import { ArtifactLinks, artifactFiles, computerScreenshot } from "./artifact-content";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep
} from "./chain-of-thought";
import { Shimmer } from "./shimmer";

export type AgentPart = {
  id?: string;
  type: string;
  toolCallId?: string;
  text?: string;
  state?: string;
  title?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  data?: unknown;
  errorText?: string;
  filename?: string;
  url?: string;
};

export function isAgentActivityPart(part: AgentPart): boolean {
  return part.type === "reasoning" || part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

export function AgentActivity({ parts }: { parts: AgentPart[] }) {
  const active = parts.some((part) => activityState(part) === "active");
  const failed = parts.some((part) => activityState(part) === "failed");
  const [open, setOpen] = useState(active);
  return (
    <ChainOfThought open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <ChainOfThoughtHeader aria-label="Agent activity">
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground">Agent activity</span>
          <span className="text-[11px] font-normal tabular-nums text-tertiary">
            {parts.length} {parts.length === 1 ? "step" : "steps"}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={
              active
                ? "hqbot-activity-pulse size-1.5 rounded-full bg-foreground"
                : failed
                  ? "size-1.5 rounded-full bg-destructive"
                  : "size-1.5 rounded-full bg-foreground/35"
            }
          />
          {active ? <Shimmer>Working</Shimmer> : failed ? "Finished with an issue" : "Completed"}
        </span>
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {parts.map((part, index) =>
          part.type === "reasoning" ? (
            <ChainOfThoughtStep
              icon={PiLightbulb}
              key={part.id ?? `reasoning:${index}`}
              label="Thought process"
              description={part.text}
              status={part.state === "streaming" ? "active" : "complete"}
            />
          ) : (
            <ToolStep key={part.id ?? part.toolCallId ?? `tool:${index}`} part={part} />
          )
        )}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

function ToolStep({ part }: { part: AgentPart }) {
  const failed =
    Boolean(part.errorText) || part.state === "output-error" || toolOutputFailed(part.output);
  const finished = part.output !== undefined || part.state === "output-available";
  const screenshot = computerScreenshot(part.output);
  const artifacts = artifactFiles(part.output);
  const label = toolLabel(part);
  const state = failed ? "failed" : finished ? "complete" : "active";
  const icon: IconType = failed ? PiWarning : finished ? PiCheck : PiSpinnerGap;
  const description = failed
    ? (part.errorText ?? "Tool failed")
    : finished
      ? screenshot
        ? "Screenshot captured"
        : artifacts.length > 0
          ? `${artifacts.length} files created`
          : summarize(part.output)
      : "Working…";

  return (
    <ChainOfThoughtStep
      className={
        failed
          ? "[&_.activity-step-icon]:text-destructive"
          : state === "active"
            ? "[&_.activity-step-icon_svg]:animate-spin motion-reduce:[&_.activity-step-icon_svg]:animate-none"
            : undefined
      }
      icon={icon}
      label={
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span className="truncate capitalize">{label}</span>
          <Badge
            className="shrink-0 rounded-full px-2 py-0 text-[10px] font-medium"
            variant={failed ? "destructive" : "outline"}
          >
            {failed ? "Failed" : finished ? "Done" : "Live"}
          </Badge>
        </span>
      }
      status={state === "failed" ? "complete" : state}
      description={description}
    >
      <div className="space-y-3">
        {screenshot ? (
          <a
            aria-label={`Open ${screenshot.label.toLocaleLowerCase()}`}
            className="block overflow-hidden rounded-xl border border-divider bg-reader shadow-sm"
            href={screenshot.url}
            target="_blank"
            rel="noreferrer"
          >
            <img
              alt={screenshot.label}
              className="h-auto max-h-[32rem] w-full object-contain"
              src={screenshot.url}
            />
          </a>
        ) : null}
        {artifacts.length > 0 ? <ArtifactLinks files={artifacts} previews /> : null}
        <details
          className="group/tool overflow-hidden rounded-xl border border-divider bg-reader/80 text-xs"
          data-slot="tool-details"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 font-medium text-foreground transition-colors hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
            <PiFile className="size-3.5 text-tertiary" />
            <span className="min-w-0 flex-1 truncate capitalize">{label} details</span>
            <span className="text-[10px] font-normal text-tertiary">Input · Output</span>
            <PiCaretDown className="size-3 text-tertiary transition-transform group-open/tool:rotate-180" />
          </summary>
          <div className="grid gap-3 border-t border-divider p-3 lg:grid-cols-2">
            <ToolValue label="Input" value={part.input} />
            <ToolValue
              label="Output"
              value={failed ? (part.errorText ?? part.output ?? "Tool failed") : part.output}
            />
          </div>
        </details>
      </div>
    </ChainOfThoughtStep>
  );
}

function activityState(part: AgentPart): "active" | "complete" | "failed" {
  if (part.type === "reasoning") return part.state === "streaming" ? "active" : "complete";
  if (part.errorText || part.state === "output-error" || toolOutputFailed(part.output))
    return "failed";
  return part.output !== undefined || part.state === "output-available" ? "complete" : "active";
}

function toolLabel(part: AgentPart): string {
  return part.title ?? part.toolName ?? part.type.replace(/^tool-/u, "").replaceAll("-", " ");
}

export function toolOutputFailed(output: unknown): boolean {
  if (!output || typeof output !== "object" || Array.isArray(output)) return false;
  const value = output as Record<string, unknown>;
  return (
    value.success === false ||
    (typeof value.exitCode === "number" && value.exitCode !== 0) ||
    (typeof value.error === "string" && value.error.trim().length > 0)
  );
}

function ToolValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">
        {label}
      </p>
      <pre className="max-h-80 min-h-16 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/70 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
        {formatToolValue(value, label)}
      </pre>
    </div>
  );
}

function formatToolValue(value: unknown, label: string): string {
  if (value === undefined) return label === "Input" ? "No input" : "Waiting for output";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(
      value,
      (_key, nested) =>
        isInlineScreenshot(nested) ? { ...nested, data: "[Image displayed above]" } : nested,
      2
    );
  } catch {
    return String(value);
  }
}

function isInlineScreenshot(value: unknown): value is Record<string, unknown> & { data: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.type === "browser_screenshot" || record.type === "desktop_screenshot") &&
    typeof record.mediaType === "string" &&
    record.mediaType.startsWith("image/") &&
    typeof record.data === "string"
  );
}

function summarize(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "Waiting for output";
  try {
    const text = JSON.stringify(value);
    return text.length > 150 ? `${text.slice(0, 147)}…` : text;
  } catch {
    return "Output ready";
  }
}
