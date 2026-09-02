import { type FormEvent, useState } from "react";
import { PiCalendar, PiCaretDown } from "react-icons/pi";

import type { BotTeammate } from "../../../domain/types";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

export function RoutineDialog({
  bot,
  open,
  onChanged,
  onOpenChange
}: {
  bot: BotTeammate;
  open: boolean;
  onChanged: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("1440");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api(`/api/bots/${bot.id}/routines`, {
        method: "POST",
        body: JSON.stringify({ intervalMinutes: Number(intervalMinutes), name, prompt })
      });
      await onChanged();
      setName("");
      setPrompt("");
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, "The routine could not be saved"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)]">
        <DialogHeader>
          <DialogTitle>New routine</DialogTitle>
          <DialogDescription>
            Schedule repeat work for {bot.name}. The computer starts only when work needs it.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="routine-name">Name</FieldLabel>
              <Input
                id="routine-name"
                maxLength={100}
                placeholder="Daily market brief"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="routine-prompt">Task</FieldLabel>
              <Textarea
                id="routine-prompt"
                maxLength={4000}
                required
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </Field>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="routine-interval">Repeat every</FieldLabel>
              <div className="relative">
                <select
                  aria-invalid={error ? true : undefined}
                  className="h-[38px] w-full appearance-none rounded-[calc(var(--radius)+2px)] border border-input bg-background px-3 pr-9 text-sm text-foreground shadow-sm outline-none transition-[color,background-color,border-color] duration-200 focus-visible:border-ring focus-visible:shadow-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive motion-reduce:transition-none"
                  id="routine-interval"
                  required
                  value={intervalMinutes}
                  onChange={(event) => setIntervalMinutes(event.target.value)}
                >
                  <option value="1">1 minute</option>
                  <option value="5">5 minutes</option>
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                  <option value="360">6 hours</option>
                  <option value="720">12 hours</option>
                  <option value="1440">1 day</option>
                  <option value="10080">1 week</option>
                  <option value="43200">30 days</option>
                </select>
                <PiCaretDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-tertiary" />
              </div>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={pending}
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button disabled={pending || !name.trim() || !prompt.trim()} type="submit">
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PiCalendar data-icon="inline-start" />
              )}{" "}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
