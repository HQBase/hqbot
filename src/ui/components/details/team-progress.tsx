import { useEffect, useState } from "react";
import type { TeamAssignment, TeamWork } from "../../../domain/team-work";
import { api, errorMessage } from "../../lib/api";
import { MarkdownText } from "../chat/markdown-text";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { ActivityStatus, ActivityTime } from "./activity-parts";
import { TeamAssignmentCard } from "./team-assignment-card";

export function TeamProgress({
  botId,
  onLoaded
}: {
  botId: string;
  onLoaded?: (hasWork: boolean) => void;
}) {
  const [view, setView] = useState<{ work: TeamWork | null; names: Record<string, string> } | null>(
    null
  );
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision refreshes after a saved request.
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await api<{ work: TeamWork | null; names: Record<string, string> }>(
          `/api/bots/${botId}/team-work`,
          { signal: controller.signal }
        );
        if (!controller.signal.aborted) {
          setView(result);
          onLoaded?.(Boolean(result.work));
          setError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(errorMessage(cause, "Team progress could not load"));
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [botId, onLoaded, revision]);
  const work = view?.work;
  const warning = error ? (
    <Alert variant="destructive">
      <AlertDescription>
        {error}
        {work ? " Showing the last saved progress." : ""}
        <Button
          className="mt-2 self-start"
          size="sm"
          variant="outline"
          onClick={() => setRevision((value) => value + 1)}
        >
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  ) : null;
  if (!work || !view) return warning;
  return (
    <section aria-label="Team task" className="mb-6 flex flex-col gap-3 text-sm">
      {warning}
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
          {work.result && <MarkdownText text={work.result} />}
        </CardContent>
      </Card>
      {work.assignments.length > 0 && <h3 className="mt-1 font-medium">Assignments</h3>}
      {orderedAssignments(work.assignments).map((item) => (
        <div key={item.id} style={{ marginLeft: `${Math.max(0, (item.depth ?? 1) - 1) * 8}px` }}>
          <TeamAssignmentCard
            item={item}
            work={work}
            names={view.names}
            botId={botId}
            onUpdated={() => setRevision((value) => value + 1)}
          />
        </div>
      ))}
    </section>
  );
}

function orderedAssignments(items: TeamAssignment[]) {
  const ordered: TeamAssignment[] = [];
  const visit = (parentId: string | null) => {
    for (const item of items.filter((item) => (item.parentId ?? null) === parentId)) {
      ordered.push(item);
      visit(item.id);
    }
  };
  for (const item of items.filter(
    (item) => item.parentId && !items.some((parent) => parent.id === item.parentId)
  )) {
    ordered.push(item);
    visit(item.id);
  }
  visit(null);
  return ordered;
}
