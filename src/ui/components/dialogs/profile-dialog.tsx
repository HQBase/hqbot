import { type FormEvent, useState } from "react";
import { PiCheck, PiCopy, PiPause, PiPushPin } from "react-icons/pi";

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

export function ProfileDialog({
  bot,
  open,
  onOpenChange,
  onSaved
}: {
  bot: BotTeammate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (botId: string) => Promise<void>;
}) {
  const [name, setName] = useState(bot.name);
  const [title, setTitle] = useState(bot.title);
  const [description, setDescription] = useState(bot.description);
  const [dailyBudget, setDailyBudget] = useState(String(bot.dailyBudgetUsd));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function update(input: Record<string, unknown>): Promise<boolean> {
    setPending(true);
    setError("");
    try {
      await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify(input) });
      await onSaved(bot.id);
      return true;
    } catch (cause) {
      setError(errorMessage(cause, "The teammate could not be updated"));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (await update({ dailyBudgetUsd: Number(dailyBudget), description, name, title })) {
      onOpenChange(false);
    }
  }

  async function duplicate(): Promise<void> {
    setPending(true);
    try {
      const result = await api<{ teammate: BotTeammate }>(`/api/bots/${bot.id}/duplicate`, {
        method: "POST"
      });
      await onSaved(result.teammate.id);
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, "The teammate could not be duplicated"));
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)]">
        <DialogHeader>
          <DialogTitle>Edit {bot.name}</DialogTitle>
          <DialogDescription>
            Change this teammate without losing its memory or work.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={(event) => void save(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="profile-name">Name</FieldLabel>
              <Input
                id="profile-name"
                maxLength={80}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-title">Job</FieldLabel>
              <Input
                id="profile-title"
                maxLength={120}
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="profile-description">Description</FieldLabel>
              <Textarea
                aria-invalid={error ? true : undefined}
                id="profile-description"
                maxLength={1000}
                required
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-budget">Daily budget (USD)</FieldLabel>
              <Input
                id="profile-budget"
                max="50"
                min="0.1"
                required
                step="0.1"
                type="number"
                value={dailyBudget}
                onChange={(event) => setDailyBudget(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void update({ pinned: !bot.pinned })}
            >
              <PiPushPin data-icon="inline-start" /> {bot.pinned ? "Unpin" : "Pin"}
            </Button>
            <Button
              disabled={pending}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void duplicate()}
            >
              <PiCopy data-icon="inline-start" /> Duplicate
            </Button>
            <Button
              disabled={pending}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void update({ hidden: !bot.hidden })}
            >
              <PiPause data-icon="inline-start" /> {bot.hidden ? "Restore" : "Archive"}
            </Button>
          </div>
          <DialogFooter>
            <Button
              disabled={pending}
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PiCheck data-icon="inline-start" />
              )}{" "}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
