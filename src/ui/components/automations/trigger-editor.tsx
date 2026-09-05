import { useState } from "react";
import type { Automation } from "../../../domain/automations";
import { type EventFilter, type EventTrigger, eventTriggerInput } from "../../../domain/events";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";

const links = {
  generic: "https://github.com/HQBase/hqbot/blob/main/docs/events.md",
  github: "https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks",
  slack: "https://docs.slack.dev/apis/events-api/"
};
export function TriggerEditor({
  routine,
  trigger,
  onClose,
  onSaved
}: {
  routine: Automation;
  trigger?: EventTrigger;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [id] = useState(() => trigger?.id ?? crypto.randomUUID());
  const [name, setName] = useState(trigger?.name ?? "");
  const [filter, setFilter] = useState<EventFilter>(
    trigger?.filter ?? { provider: "generic", eventType: "" }
  );
  const [enabled, setEnabled] = useState(trigger?.enabled ?? true);
  const [secret, setSecret] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {savedKey ? "Trigger ready" : trigger ? "Edit event trigger" : "Add event trigger"}
          </DialogTitle>
          <DialogDescription>
            {savedKey
              ? "Save the signing key in your service. HQBot will not show it again after you close this window."
              : "Choose the events that can start this routine."}
          </DialogDescription>
        </DialogHeader>
        {savedKey ? (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="saved-event-url">Event URL</FieldLabel>
              <Input
                id="saved-event-url"
                readOnly
                value={`${location.origin}/events/${id}`}
                onFocus={(event) => event.currentTarget.select()}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="saved-event-key">Signing key</FieldLabel>
              <Input
                id="saved-event-key"
                type="password"
                readOnly
                value={savedKey}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(savedKey);
                  } catch {
                    setError("The key could not be copied. Select and copy it.");
                  }
                }}
              >
                Copy signing key
              </Button>
            </Field>
            <a
              className="text-sm underline"
              href={links[filter.provider]}
              target="_blank"
              rel="noreferrer"
            >
              Open setup instructions
            </a>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-5"
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              setPending(true);
              try {
                const input = eventTriggerInput.parse({
                  id,
                  revision: trigger?.revision,
                  botId: routine.botId,
                  routineId: routine.id,
                  name,
                  enabled,
                  filter,
                  secret: secret || undefined
                });
                const result = await api<{ trigger: EventTrigger; secret?: string }>(
                  "/api/event-triggers",
                  { method: "POST", body: JSON.stringify(input) }
                );
                await onSaved();
                if (result.secret) setSavedKey(result.secret);
                else onClose();
              } catch (cause) {
                setError(errorMessage(cause, "Trigger could not be saved"));
              } finally {
                setPending(false);
              }
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="trigger-name">Name</FieldLabel>
                <Input
                  id="trigger-name"
                  value={name}
                  maxLength={100}
                  required
                  onChange={(event) => setName(event.target.value)}
                  placeholder="New support request"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="trigger-provider">Service</FieldLabel>
                <select
                  id="trigger-provider"
                  disabled={Boolean(trigger)}
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={filter.provider}
                  onChange={(event) =>
                    setFilter(
                      event.target.value === "slack"
                        ? { provider: "slack", teamId: "", channelId: "" }
                        : event.target.value === "github"
                          ? { provider: "github", repository: "", action: "" }
                          : { provider: "generic", eventType: "" }
                    )
                  }
                >
                  <option value="generic">Generic webhook</option>
                  <option value="github">GitHub</option>
                  <option value="slack">Slack</option>
                </select>
              </Field>
              {filter.provider === "generic" && (
                <Field>
                  <FieldLabel htmlFor="event-type">Event type (optional)</FieldLabel>
                  <Input
                    id="event-type"
                    value={filter.eventType}
                    onChange={(event) => setFilter({ ...filter, eventType: event.target.value })}
                    placeholder="ticket.created"
                  />
                </Field>
              )}
              {filter.provider === "github" && (
                <>
                  <Field>
                    <FieldLabel htmlFor="event-repo">Repository</FieldLabel>
                    <Input
                      id="event-repo"
                      value={filter.repository}
                      required
                      placeholder="owner/repository"
                      onChange={(event) => setFilter({ ...filter, repository: event.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="event-action">Action (optional)</FieldLabel>
                    <Input
                      id="event-action"
                      value={filter.action}
                      placeholder="opened"
                      onChange={(event) => setFilter({ ...filter, action: event.target.value })}
                    />
                  </Field>
                </>
              )}
              {filter.provider === "slack" && (
                <>
                  <Field>
                    <FieldLabel htmlFor="event-team">Slack workspace ID</FieldLabel>
                    <Input
                      id="event-team"
                      value={filter.teamId}
                      required
                      placeholder="T0123456"
                      onChange={(event) => setFilter({ ...filter, teamId: event.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="event-channel">Slack channel ID</FieldLabel>
                    <Input
                      id="event-channel"
                      value={filter.channelId}
                      required
                      placeholder="C0123456"
                      onChange={(event) => setFilter({ ...filter, channelId: event.target.value })}
                    />
                  </Field>
                </>
              )}
              {(filter.provider === "slack" || trigger) && (
                <Field>
                  <FieldLabel htmlFor="event-key">
                    {trigger ? "New signing key (optional)" : "Slack app signing secret"}
                  </FieldLabel>
                  <Input
                    id="event-key"
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    minLength={16}
                    maxLength={256}
                    required={!trigger && filter.provider === "slack"}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                  {trigger && (
                    <p className="text-xs text-muted-foreground">
                      Leave empty to keep the current key. A new key stops requests signed with the
                      old one.
                    </p>
                  )}
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                Enabled
              </label>
              <a
                className="text-sm underline"
                href={links[filter.provider]}
                target="_blank"
                rel="noreferrer"
              >
                Setup instructions
              </a>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save trigger"}
              </Button>
            </DialogFooter>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
