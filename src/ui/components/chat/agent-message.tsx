import { PiFile, PiGlobe } from "react-icons/pi";

import { initials } from "../../lib/format";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { AgentActivity, type AgentPart, isAgentActivityPart } from "./agent-activity";
import { ArtifactLinks, artifactReferences } from "./artifact-content";
import { MarkdownText } from "./markdown-text";
import { Shimmer } from "./shimmer";

export type { AgentPart } from "./agent-activity";

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
  const visibleParts = parts.filter(
    (part) =>
      part.type !== "step-start" &&
      ((part.type !== "text" && part.type !== "reasoning") || Boolean(part.text?.trim()))
  );
  if (visibleParts.length === 0) return null;

  if (user) {
    return (
      <div className="ml-auto flex max-w-[88%] justify-end sm:max-w-[78%]">
        <div className="rounded-[1.25rem] rounded-br-md bg-primary px-4 py-3 text-primary-foreground shadow-[0_8px_24px_hsl(var(--foreground)/0.08)]">
          <div className="flex flex-col gap-2.5">
            {visibleParts.map((part, index) => (
              <MessagePart key={part.id ?? `${part.type}:${index}`} part={part} user />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const sections = groupAssistantParts(visibleParts);

  return (
    <article className="flex w-full max-w-[96%] gap-3.5 sm:gap-4">
      <Avatar className="mt-0.5 size-8 border border-divider shadow-sm">
        <AvatarFallback className="bg-gradient-to-br from-muted to-card text-[10px] font-semibold">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-[11px] font-semibold tracking-[0.01em] text-tertiary">{name}</p>
        <div className="flex flex-col gap-4">
          {sections.map((section, index) =>
            section.type === "activity" ? (
              <AgentActivity key={section.key} parts={section.parts} />
            ) : (
              <MessagePart
                key={section.part.id ?? `${section.part.type}:${index}`}
                part={section.part}
                user={false}
              />
            )
          )}
        </div>
      </div>
    </article>
  );
}

export function ThinkingIndicator({
  label,
  name,
  recovering = false
}: {
  label?: string;
  name: string;
  recovering?: boolean;
}) {
  const status = label ?? (recovering ? "Recovering" : "Thinking…");
  return (
    <div aria-live="polite" className="flex w-full max-w-[96%] gap-3.5 sm:gap-4" role="status">
      <Avatar className="mt-0.5 size-8 border border-divider shadow-sm">
        <AvatarFallback className="bg-gradient-to-br from-muted to-card text-[10px] font-semibold">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-[11px] font-semibold text-tertiary">{name}</p>
        <div className="flex w-fit items-center gap-2 rounded-full border border-divider bg-card/80 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          <Shimmer>{status}</Shimmer>
        </div>
      </div>
    </div>
  );
}

type AssistantSection =
  | { type: "activity"; key: string; parts: AgentPart[] }
  | { type: "content"; part: AgentPart };

function groupAssistantParts(parts: AgentPart[]): AssistantSection[] {
  const sections: AssistantSection[] = [];
  for (const part of parts) {
    if (!isAgentActivityPart(part)) {
      sections.push({ type: "content", part });
      continue;
    }
    const previous = sections.at(-1);
    if (previous?.type === "activity") previous.parts.push(part);
    else
      sections.push({
        type: "activity",
        key: part.id ?? part.toolCallId ?? `activity:${sections.length}`,
        parts: [part]
      });
  }
  return sections;
}

function MessagePart({ part, user }: { part: AgentPart; user: boolean }) {
  if (part.type === "text") return <MarkdownText text={part.text ?? ""} user={user} />;
  if (part.type === "data-artifacts")
    return <ArtifactLinks files={artifactReferences(part.data)} />;
  if (part.type === "file") {
    return (
      <a
        className="flex items-center gap-2 rounded-xl border border-divider bg-card/70 p-2.5 text-xs shadow-sm transition-colors hover:bg-muted"
        href={part.url}
      >
        <PiFile /> {part.filename ?? "File"}
      </a>
    );
  }
  if (part.type === "source-url") {
    return (
      <a
        className="flex w-fit items-center gap-2 rounded-full border border-divider bg-card/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
