import { useState } from "react";
import { toast } from "sonner";
import { hqbotModelName } from "../../../domain/models";
import type { TeamAssignment, TeamWork } from "../../../domain/team-work";
import { api, errorMessage } from "../../lib/api";
import { MarkdownText } from "../chat/markdown-text";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Field, FieldLabel } from "../ui/field";
import { Separator } from "../ui/separator";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { ActivityStatus, ActivityTime } from "./activity-parts";

export function TeamAssignmentCard({
  item,
  work,
  names,
  botId,
  onUpdated
}: {
  item: TeamAssignment;
  work: TeamWork;
  names: Record<string, string>;
  botId: string;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active =
    ["active", "waiting"].includes(work.state) && ["queued", "submitted"].includes(item.state);
  const request = work.updates?.find(
    (update) => update.assignmentId === item.id && update.kind !== "report" && !update.acknowledged
  );
  async function send(action: "check_in" | "redirect") {
    setPending(true);
    setError("");
    try {
      await api(`/api/bots/${botId}/team-work/updates`, {
        method: "POST",
        body: JSON.stringify({
          action,
          assignmentId: item.id,
          workId: work.id,
          key: crypto.randomUUID(),
          message:
            action === "check_in"
              ? "Report your progress, any blocker, and the next step. Then continue the assignment."
              : message.trim()
        })
      });
      setEditing(false);
      setMessage("");
      onUpdated();
      toast.success(action === "check_in" ? "Check-in requested" : "Guidance sent");
    } catch (cause) {
      setError(errorMessage(cause, "The request could not be sent"));
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="group/assignment min-w-0 rounded-xl border border-divider bg-card p-3">
      <summary className="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <span className="inline-flex flex-wrap items-center gap-2">
          <strong className="font-medium">{names[item.botId] ?? "Specialist"}</strong>
          <ActivityStatus
            state={
              item.progress?.blocked && active
                ? "blocked"
                : item.waiting && active
                  ? "waiting"
                  : item.state
            }
          />
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          Reports to {names[item.managerBotId || work.ownerBotId] ?? "task owner"}
        </span>
        <span className="mt-2 line-clamp-3 break-words text-sm leading-relaxed group-open/assignment:line-clamp-none">
          {item.instruction}
        </span>
        {item.progress && (
          <span className="mt-2 line-clamp-2 break-words text-xs text-muted-foreground group-open/assignment:line-clamp-none">
            {item.progress.summary}
          </span>
        )}
      </summary>
      <div className="mt-4 flex min-w-0 flex-col gap-4 leading-relaxed">
        <Separator />
        {item.modelId && (
          <p className="text-xs text-muted-foreground">
            {hqbotModelName(item.modelId)} · <ActivityTime value={item.updatedAt} />
          </p>
        )}
        {item.progress && (
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">Next step</h4>
            <MarkdownText text={item.progress.nextStep} />
          </div>
        )}
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">Required evidence</h4>
          <MarkdownText text={item.criterion} />
        </div>
        {item.result && (
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">Returned result</h4>
            <MarkdownText text={item.result} />
          </div>
        )}
        {item.review && (
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">Manager review</h4>
            <MarkdownText text={item.review} />
          </div>
        )}
        {active && (
          <>
            {request && (
              <Alert>
                <AlertDescription>
                  {request.kind === "redirect" ? "Guidance sent." : "Check-in requested."} The
                  teammate will read it at the next safe step.
                </AlertDescription>
              </Alert>
            )}
            {editing ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send("redirect");
                }}
              >
                <Field>
                  <FieldLabel htmlFor={`guidance-${item.id}`}>Updated guidance</FieldLabel>
                  <Textarea
                    autoFocus
                    id={`guidance-${item.id}`}
                    maxLength={4000}
                    required
                    value={message}
                    disabled={pending}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Explain what needs to change within this assignment."
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" type="submit" disabled={pending || !message.trim()}>
                    {pending && <Spinner data-icon="inline-start" />}Send guidance
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    disabled={pending}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || Boolean(request)}
                  onClick={() => void send("check_in")}
                >
                  {pending && <Spinner data-icon="inline-start" />}Check in
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || Boolean(request)}
                  onClick={() => setEditing(true)}
                >
                  Change guidance
                </Button>
              </div>
            )}
          </>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </details>
  );
}
