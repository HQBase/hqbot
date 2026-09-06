import { Badge } from "../ui/badge";

const labels: Record<string, string> = {
  active: "Working",
  blocked: "Blocked",
  queued: "Queued",
  submitted: "Working",
  returned: "Needs review",
  reviewed: "Reviewed",
  done: "Done",
  completed: "Complete",
  verified: "Verified",
  running: "Working",
  scheduled: "Scheduled",
  waiting: "Waiting",
  waiting_user: "Needs your input",
  cancelled: "Stopped",
  failed: "Failed",
  pending: "Waiting",
  approved: "Approved",
  applied: "Complete",
  confirmed: "Confirmed",
  uncertain: "Needs a check",
  denied: "Declined",
  executing: "In progress",
  prepared: "Ready",
  rejected: "Declined"
};
export function ActivityStatus({ state }: { state: string }) {
  return (
    <Badge
      variant={["failed", "uncertain", "blocked"].includes(state) ? "destructive" : "secondary"}
    >
      {labels[state] ?? state.replaceAll("_", " ")}
    </Badge>
  );
}
export function ActivityTime({ value }: { value: string }) {
  const date = new Date(value);
  return (
    <time className="text-xs text-muted-foreground" dateTime={value} title={date.toLocaleString()}>
      {date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })}
    </time>
  );
}
export function ActivityEvidence({ value }: { value: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return <p className="whitespace-pre-wrap break-words">{value}</p>;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const key = JSON.stringify(item);
        if (!item || typeof item !== "object") return <p key={key}>{String(item ?? "")}</p>;
        const fields = item as Record<string, unknown>;
        return (
          <div key={key} className="flex flex-col gap-1">
            <p className="whitespace-pre-wrap break-words">
              {String(fields.check ?? fields.reason ?? fields.description ?? "Saved evidence")}
            </p>
            {Boolean(fields.artifactId || fields.actionId) && (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Evidence reference
                </summary>
                <p className="mt-2 break-all text-xs">
                  {String(fields.artifactId ?? fields.actionId)}
                </p>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
