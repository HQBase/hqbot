import { teamQuestions } from "../../../domain/team-questions";
import type { TeamWork } from "../../../domain/team-work";
import { MarkdownText } from "../chat/markdown-text";
import { Badge } from "../ui/badge";
import { ActivityTime } from "./activity-parts";

export function TeamQuestions({ work, names }: { work: TeamWork; names: Record<string, string> }) {
  const questions = teamQuestions(work.updates);
  if (!questions.length) return null;
  const active = ["active", "waiting"].includes(work.state);
  return (
    <section aria-label="Specialist questions" className="flex min-w-0 flex-col gap-3">
      <h3 className="font-medium">Specialist questions</h3>
      {questions.map((item) => (
        <details
          key={item.id}
          className="group/question min-w-0 rounded-xl border border-divider bg-card p-3"
        >
          <summary className="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {names[item.senderBotId] ?? "Specialist"} →{" "}
                {names[item.recipientBotId] ?? "Specialist"}
              </span>
              <Badge variant="secondary">
                {item.response?.kind === "answer"
                  ? "Answered"
                  : item.response || !active
                    ? "Closed"
                    : "Waiting for answer"}
              </Badge>
            </span>
            <span className="mt-2 line-clamp-2 whitespace-pre-wrap break-words leading-relaxed group-open/question:line-clamp-none">
              {item.question}
            </span>
          </summary>
          <div className="mt-3 flex min-w-0 flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              <ActivityTime value={item.createdAt} />
            </p>
            {item.response ? (
              <MarkdownText text={item.response.message} />
            ) : (
              <p className="text-muted-foreground">
                {active
                  ? "The specialist will read this at a safe step. Questions close after ten minutes."
                  : "The task ended before an answer was saved."}
              </p>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
