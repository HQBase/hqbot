import { PiBrain, PiCheck, PiFile, PiGlobe, PiWarning } from "react-icons/pi";

import { initials } from "../../lib/format";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import { MarkdownText } from "./markdown-text";

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
  errorText?: string;
  filename?: string;
  url?: string;
};

export function AgentMessage({
  name,
  parts,
  speaker
}: {
  name: string;
  parts: AgentPart[];
  speaker: "assistant" | "user";
}) {
  const user = speaker === "user";
  return (
    <div className={user ? "ml-auto flex max-w-[88%] justify-end" : "flex max-w-[92%] gap-3"}>
      {!user ? (
        <Avatar className="mt-1 size-7">
          <AvatarFallback className="text-[10px] font-semibold">{initials(name)}</AvatarFallback>
        </Avatar>
      ) : null}
      <div
        className={
          user
            ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground"
            : "min-w-0 flex-1"
        }
      >
        {!user ? <p className="mb-1.5 text-[11px] font-medium text-tertiary">{name}</p> : null}
        <div className="flex flex-col gap-2.5">
          {parts.map((part, index) => (
            <MessagePart
              key={part.id ?? part.toolCallId ?? `${part.type}:${index}`}
              part={part}
              user={user}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ThinkingIndicator({
  name,
  recovering = false
}: {
  name: string;
  recovering?: boolean;
}) {
  const label = recovering ? "Recovering" : "Thinking";
  return (
    <div aria-live="polite" className="flex max-w-[92%] gap-3" role="status">
      <Avatar className="mt-1 size-7">
        <AvatarFallback className="text-[10px] font-semibold">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 text-[11px] font-medium text-tertiary">{name}</p>
        <div className="flex h-6 items-center gap-2 text-xs text-muted-foreground">
          <span>{label}</span>
          <span aria-hidden="true" className="flex items-center gap-1">
            {[0, 1, 2].map((index) => (
              <i
                className="hqbot-thinking-dot size-1 rounded-full bg-current"
                key={index}
                style={{ animationDelay: `${index * 160}ms` }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

function MessagePart({ part, user }: { part: AgentPart; user: boolean }) {
  if (part.type === "text") {
    return <MarkdownText text={part.text ?? ""} user={user} />;
  }
  if (part.type === "reasoning") {
    return (
      <details className="rounded-lg border border-divider bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <summary className="flex cursor-pointer items-center gap-2 font-medium text-foreground">
          <PiBrain /> Thought process
        </summary>
        <p className="mt-2 whitespace-pre-wrap leading-5">{part.text}</p>
      </details>
    );
  }
  if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
    return <ToolPart part={part} />;
  }
  if (part.type === "file") {
    return (
      <a
        className="flex items-center gap-2 rounded-lg border border-divider p-2 text-xs hover:bg-muted"
        href={part.url}
      >
        <PiFile /> {part.filename ?? "File"}
      </a>
    );
  }
  if (part.type === "source-url") {
    return (
      <a
        className="flex items-center gap-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
        href={part.url}
        rel="noreferrer"
        target="_blank"
      >
        <PiGlobe /> {part.title ?? part.url}
      </a>
    );
  }
  return user ? null : <Badge variant="outline">{part.type.replaceAll("-", " ")}</Badge>;
}

function ToolPart({ part }: { part: AgentPart }) {
  const failed = Boolean(part.errorText) || part.state === "output-error";
  const finished = part.output !== undefined || part.state === "output-available";
  const label =
    part.title ?? part.toolName ?? part.type.replace(/^tool-/u, "").replaceAll("-", " ");
  return (
    <Card className="overflow-hidden bg-card/70 shadow-none">
      <CardContent className="flex items-start gap-3 p-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-divider bg-reader">
          {failed ? <PiWarning /> : finished ? <PiCheck /> : <PiGlobe />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium capitalize">{label}</p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {failed
              ? (part.errorText ?? "Tool failed")
              : finished
                ? summarize(part.output)
                : "Working…"}
          </p>
        </div>
        <Badge variant="outline">{failed ? "Failed" : finished ? "Done" : "Live"}</Badge>
      </CardContent>
    </Card>
  );
}

function summarize(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "Waiting for output";
  try {
    return JSON.stringify(value);
  } catch {
    return "Output ready";
  }
}
