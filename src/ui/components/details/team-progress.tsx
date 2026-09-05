import { useEffect, useState } from "react";
import type { TeamWork } from "../../../domain/team-work";
import { api, errorMessage } from "../../lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { ActivityStatus, ActivityTime } from "./activity-parts";

export function TeamProgress({ botId }: { botId: string }) {
  const [view, setView] = useState<{ work: TeamWork | null; names: Record<string, string> } | null>(
    null
  );
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setError("");
    const load = () =>
      api<{ work: TeamWork | null; names: Record<string, string> }>(
        `/api/bots/${botId}/team-work`,
        { signal: controller.signal }
      ).then(
        (result) => {
          if (!controller.signal.aborted) {
            setView(result);
            setError("");
          }
        },
        (cause) => {
          if (!controller.signal.aborted)
            setError(errorMessage(cause, "Team progress could not load"));
        }
      );
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [botId]);
  const work = view?.work;
  if (error)
    return (
      <p role="alert" className="py-3 text-sm text-destructive">
        {error}
      </p>
    );
  if (!work || !view) return null;
  return (
    <section aria-label="Team task" className="mb-6 flex flex-col gap-3 text-sm">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Team task</span>
            <ActivityStatus state={work.state} />
          </div>
          <CardTitle className="break-words leading-snug">{work.goal}</CardTitle>
          <CardDescription>
            Owned by {view.names[work.ownerBotId] ?? "the group lead"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Deadline</dt>
            <dd className="text-right">
              <ActivityTime value={work.deadlineAt} />
            </dd>
            <dt className="text-muted-foreground">Model budget</dt>
            <dd className="text-right tabular-nums">
              ${work.spentUsd.toFixed(3)} / ${work.budgetUsd.toFixed(2)}
            </dd>
          </dl>
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Completion checks</h3>
            <ul className="flex list-disc flex-col gap-2 pl-4">
              {work.criteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          </div>
          {work.result && (
            <p className="whitespace-pre-wrap break-words border-t pt-4 leading-relaxed">
              {work.result}
            </p>
          )}
        </CardContent>
      </Card>
      {work.assignments.length > 0 && <h3 className="mt-1 font-medium">Assignments</h3>}
      {work.assignments.map((item) => (
        <details key={item.id} className="rounded-xl border border-divider bg-card p-3">
          <summary className="cursor-pointer">
            <span className="inline-flex flex-wrap items-center gap-2">
              <strong className="font-medium">{view.names[item.botId] ?? "Specialist"}</strong>
              <ActivityStatus state={item.state} />
            </span>
            <span className="mt-2 block text-sm leading-relaxed">{item.instruction}</span>
          </summary>
          <div className="mt-4 flex flex-col gap-4 border-t pt-4 leading-relaxed">
            <div>
              <h4 className="mb-1 text-xs font-medium text-muted-foreground">Required evidence</h4>
              <p className="break-words">{item.criterion}</p>
            </div>
            {item.result && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">Returned result</h4>
                <p className="whitespace-pre-wrap break-words">{item.result}</p>
              </div>
            )}
            {item.review && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">Owner review</h4>
                <p className="whitespace-pre-wrap break-words">{item.review}</p>
              </div>
            )}
            <ActivityTime value={item.updatedAt} />
          </div>
        </details>
      ))}
    </section>
  );
}
