import { type FormEvent, useState } from "react";
import { PiSparkle } from "react-icons/pi";
import { skillCommand } from "../../../domain/skills";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

export function SkillDialog({
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
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api(`/api/bots/${bot.id}/skills`, {
        method: "POST",
        body: JSON.stringify({ description, instructions, name })
      });
      await onChanged();
      setDescription("");
      setInstructions("");
      setName("");
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, "The skill could not be saved"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)]">
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>Add trusted, reusable instructions for {bot.name}.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="skill-name">Name</FieldLabel>
              <Input
                id="skill-name"
                maxLength={80}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {name ? <FieldDescription>Command: /{skillCommand(name)}</FieldDescription> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="skill-description">Description</FieldLabel>
              <Input
                id="skill-description"
                maxLength={300}
                required
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="skill-instructions">Instructions</FieldLabel>
              <Textarea
                aria-invalid={error ? true : undefined}
                id="skill-instructions"
                maxLength={4000}
                required
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
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
            <Button
              disabled={pending || !name.trim() || !description.trim() || !instructions.trim()}
              type="submit"
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PiSparkle data-icon="inline-start" />
              )}{" "}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
