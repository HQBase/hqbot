import { type FormEvent, useEffect, useState } from "react";
import { PiCheck, PiCpu, PiPause, PiTrash } from "react-icons/pi";

import type { HQBotModelId } from "../../../domain/models";
import type { BotTeammate } from "../../../domain/types";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { DetailsSection } from "./details-section";
import { ModelPanel } from "./model-panel";

export function AgentSettingsPanel({
  bot,
  loadCatalog = true,
  onDeleted,
  onMaxStepsChange,
  onModelChange,
  onSaved
}: {
  bot: BotTeammate;
  loadCatalog?: boolean;
  onDeleted: () => Promise<void>;
  onMaxStepsChange: (maxSteps: number | null) => Promise<void>;
  onModelChange: (modelId: HQBotModelId) => Promise<void>;
  onSaved: (botId: string) => Promise<void>;
}) {
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description);
  const [dailyBudget, setDailyBudget] = useState(String(bot.dailyBudgetUsd));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(bot.name);
    setDescription(bot.description);
    setDailyBudget(String(bot.dailyBudgetUsd));
  }, [bot.dailyBudgetUsd, bot.description, bot.name]);

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
    await update({ dailyBudgetUsd: Number(dailyBudget), description, name, title: name });
  }

  async function remove(): Promise<void> {
    setPending(true);
    setError("");
    try {
      await onDeleted();
    } catch (cause) {
      setError(errorMessage(cause, "The teammate could not be deleted"));
      setPending(false);
    }
  }

  return (
    <DetailsSection badge={pending ? "Saving" : "Config"} icon={PiCpu} title="Agent settings">
      <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
        <div>
          <label className="mb-2 block text-xs font-medium" htmlFor="teammate-name">
            Name
          </label>
          <Input
            disabled={pending}
            id="teammate-name"
            maxLength={80}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium" htmlFor="teammate-description">
            Description
          </label>
          <Textarea
            className="min-h-20"
            disabled={pending}
            id="teammate-description"
            maxLength={1000}
            required
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium" htmlFor="teammate-budget">
            Daily budget (USD)
          </label>
          <Input
            disabled={pending}
            id="teammate-budget"
            max="50"
            min="0.1"
            required
            step="0.1"
            type="number"
            value={dailyBudget}
            onChange={(event) => setDailyBudget(event.target.value)}
          />
        </div>
        <Button className="self-start" disabled={pending} size="sm" type="submit">
          {pending ? <Spinner data-icon="inline-start" /> : <PiCheck data-icon="inline-start" />}
          Save profile
        </Button>
      </form>

      <div className="my-5 border-t border-divider" />
      <ModelPanel
        loadCatalog={loadCatalog}
        maxSteps={bot.maxSteps}
        modelId={bot.modelId}
        onMaxStepsChange={onMaxStepsChange}
        onModelChange={onModelChange}
      />

      <div className="my-5 border-t border-divider" />
      {confirmDelete ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-xs font-medium">Delete {bot.name}?</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            This removes its conversation, memory, files, routines, connections, and saved computer
            state. This cannot be undone.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={pending}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setConfirmDelete(false)}
            >
              Keep teammate
            </Button>
            <Button
              disabled={pending}
              size="sm"
              type="button"
              variant="destructive"
              onClick={() => void remove()}
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PiTrash data-icon="inline-start" />
              )}
              Delete teammate
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={pending}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void update({ hidden: !bot.hidden })}
          >
            <PiPause data-icon="inline-start" /> {bot.hidden ? "Restore" : "Archive"}
          </Button>
          <Button
            disabled={pending}
            size="sm"
            type="button"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <PiTrash data-icon="inline-start" /> Delete
          </Button>
        </div>
      )}
      {error ? <p className="mt-3 text-[11px] text-destructive">{error}</p> : null}
    </DetailsSection>
  );
}
