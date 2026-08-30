import { type FormEvent, useState } from "react";
import { PiCalendar } from "react-icons/pi";

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
  const [hours, setHours] = useState("24");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api(`/api/bots/${bot.id}/routines`, {
        method: "POST",
        body: JSON.stringify({ intervalMinutes: Math.round(Number(hours) * 60), name, prompt })
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
            Schedule repeat work for {bot.name}. The browser starts only when needed.
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
              <FieldLabel htmlFor="routine-hours">Repeat every (hours)</FieldLabel>
              <Input
                aria-invalid={error ? true : undefined}
                id="routine-hours"
                max="720"
                min="0.25"
                required
                step="0.25"
                type="number"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
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
