import { type FormEvent, useState } from "react";
import {
  type Automation,
  type RoutineSchedule,
  routineScheduleLabel
} from "../../../domain/automations";
import type { BotTeammate } from "../../../domain/types";
import { api, errorMessage } from "../../lib/api";
import { formatInterval } from "../../lib/format";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const intervals = [1, 5, 15, 30, 60, 360, 720, 1440, 10080, 43200];
export function AutomationEditor({
  routine,
  bots,
  initialBotId,
  onClose,
  onSaved
}: {
  routine?: Automation;
  bots: BotTeammate[];
  initialBotId?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [botId, setBotId] = useState(routine?.botId ?? initialBotId ?? bots[0]?.id ?? "");
  const [name, setName] = useState(routine?.name ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [schedule, setSchedule] = useState<RoutineSchedule>(
    routine?.schedule ?? { kind: "interval", everyMinutes: 1440 }
  );
  const [active, setActive] = useState(routine?.active ?? true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [custom, setCustom] = useState(
    schedule.kind === "interval" && !intervals.includes(schedule.everyMinutes)
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api("/api/automations", {
        method: "POST",
        body: JSON.stringify({
          id: routine?.id,
          revision: routine?.revision,
          botId,
          name,
          prompt,
          active,
          schedule
        })
      });
      await onSaved();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, "The routine could not be saved"));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{routine ? "Edit routine" : "New routine"}</DialogTitle>
          <DialogDescription>
            Set the work once. Review each run when it finishes.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={(event) => void save(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="routine-bot">Teammate</FieldLabel>
              <select
                id="routine-bot"
                className={selectClass}
                value={botId}
                disabled={Boolean(routine)}
                required
                onChange={(event) => setBotId(event.target.value)}
              >
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="routine-name">Name</FieldLabel>
              <Input
                id="routine-name"
                value={name}
                required
                maxLength={100}
                placeholder="Morning brief"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="routine-prompt">Task</FieldLabel>
              <Textarea
                id="routine-prompt"
                value={prompt}
                required
                maxLength={4000}
                placeholder="What should the teammate do and check?"
                onChange={(event) => setPrompt(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="routine-kind">When</FieldLabel>
              <select
                id="routine-kind"
                className={selectClass}
                value={schedule.kind}
                onChange={(event) =>
                  setSchedule(
                    event.target.value === "calendar"
                      ? {
                          kind: "calendar",
                          time: "09:00",
                          days: [1, 2, 3, 4, 5],
                          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
                        }
                      : event.target.value === "event"
                        ? { kind: "event" }
                        : { kind: "interval", everyMinutes: 1440 }
                  )
                }
              >
                <option value="interval">At a regular interval</option>
                <option value="calendar">On selected days</option>
                <option value="event">When an event arrives</option>
              </select>
            </Field>
            {schedule.kind === "interval" && (
              <Field>
                <FieldLabel htmlFor="routine-interval">Repeat every</FieldLabel>
                <select
                  id="routine-interval"
                  className={selectClass}
                  value={custom ? "custom" : schedule.everyMinutes}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCustom(value === "custom");
                    if (value !== "custom")
                      setSchedule({ kind: "interval", everyMinutes: Number(value) });
                  }}
                >
                  {intervals.map((value) => (
                    <option key={value} value={value}>
                      {value === 10080 ? "1 week" : formatInterval(value)}
                    </option>
                  ))}
                  <option value="custom">Other interval…</option>
                </select>
                {custom && (
                  <Input
                    aria-label="Interval in minutes"
                    type="number"
                    min={1}
                    max={43200}
                    required
                    value={schedule.everyMinutes}
                    onChange={(event) =>
                      setSchedule({ kind: "interval", everyMinutes: Number(event.target.value) })
                    }
                  />
                )}
              </Field>
            )}
            {schedule.kind === "calendar" && (
              <>
                <Field>
                  <FieldLabel>Days</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                      <Button
                        key={day}
                        type="button"
                        size="sm"
                        variant={schedule.days.includes(index) ? "secondary" : "outline"}
                        aria-pressed={schedule.days.includes(index)}
                        onClick={() =>
                          setSchedule({
                            ...schedule,
                            days: schedule.days.includes(index)
                              ? schedule.days.filter((day) => day !== index)
                              : [...schedule.days, index]
                          })
                        }
                      >
                        {day}
                      </Button>
                    ))}
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="routine-time">Local time</FieldLabel>
                    <Input
                      type="time"
                      id="routine-time"
                      value={schedule.time}
                      required
                      onChange={(event) => setSchedule({ ...schedule, time: event.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="routine-timezone">Time zone</FieldLabel>
                    <Input
                      id="routine-timezone"
                      list="routine-zones"
                      value={schedule.timezone}
                      required
                      onChange={(event) =>
                        setSchedule({ ...schedule, timezone: event.target.value })
                      }
                    />
                    <datalist id="routine-zones">
                      {Intl.supportedValuesOf("timeZone").map((zone) => (
                        <option key={zone} value={zone} />
                      ))}
                      <option value="UTC" />
                    </datalist>
                  </Field>
                </div>
              </>
            )}
            <p className="rounded-lg bg-muted p-3 text-sm">
              {routineScheduleLabel(schedule)}
              {schedule.kind === "event" && ". Save the routine, then add an event trigger."}
            </p>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Enable this routine
            </label>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending || !botId || (schedule.kind === "calendar" && !schedule.days.length)
              }
            >
              {pending ? "Saving…" : "Save routine"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
