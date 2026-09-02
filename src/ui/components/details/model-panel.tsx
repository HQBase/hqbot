import { useEffect, useState } from "react";
import { PiCaretDown } from "react-icons/pi";

import {
  HQBOT_MODELS,
  type HQBotModel,
  type HQBotModelId,
  hqbotModelName,
  normalizeHQBotModelId
} from "../../../domain/models";
import { api } from "../../lib/api";

export function ModelPanel({
  loadCatalog = true,
  maxSteps,
  modelId,
  onMaxStepsChange,
  onModelChange
}: {
  loadCatalog?: boolean;
  maxSteps: number | null;
  modelId: string | null;
  onMaxStepsChange: (maxSteps: number | null) => Promise<void>;
  onModelChange: (modelId: HQBotModelId) => Promise<void>;
}) {
  const persisted = normalizeHQBotModelId(modelId);
  const [selected, setSelected] = useState<HQBotModelId>(persisted);
  const [selectedMaxSteps, setSelectedMaxSteps] = useState<number | null>(maxSteps);
  const [models, setModels] = useState<HQBotModel[]>(HQBOT_MODELS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setSelected(persisted), [persisted]);
  useEffect(() => setSelectedMaxSteps(maxSteps), [maxSteps]);
  useEffect(() => {
    if (!loadCatalog) return;
    let active = true;
    void api<{ models: HQBotModel[] }>("/api/models")
      .then((result) => {
        if (active && result.models.length > 0) setModels(result.models);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loadCatalog]);

  const choices = models.some((model) => model.id === selected)
    ? models
    : [
        {
          ...HQBOT_MODELS[0],
          id: selected,
          label: hqbotModelName(selected),
          description: "Saved Cloudflare AI model. Its current catalog entry is loading."
        },
        ...models
      ];
  const workersModels = choices.filter((model) => model.id.startsWith("@cf/"));
  const gatewayModels = choices.filter((model) => !model.id.startsWith("@cf/"));

  async function change(modelId: HQBotModelId): Promise<void> {
    const previous = selected;
    setSelected(modelId);
    setSaving(true);
    setError("");
    try {
      await onModelChange(modelId);
    } catch {
      setSelected(previous);
      setError("The model could not be changed");
    } finally {
      setSaving(false);
    }
  }

  async function changeMaxSteps(value: number | null): Promise<void> {
    const previous = selectedMaxSteps;
    setSelectedMaxSteps(value);
    setSaving(true);
    setError("");
    try {
      await onMaxStepsChange(value);
    } catch {
      setSelectedMaxSteps(previous);
      setError("The step limit could not be changed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium" htmlFor="teammate-model">
        Model used by this teammate
      </label>
      <div className="relative mt-2">
        <select
          className="h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-9 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-60"
          disabled={saving}
          id="teammate-model"
          value={selected}
          onChange={(event) => void change(event.target.value as HQBotModelId)}
        >
          <optgroup label="Workers AI">
            {workersModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="AI Gateway">
            {gatewayModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </optgroup>
        </select>
        <PiCaretDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-tertiary" />
      </div>
      <p className="mt-2 text-[11px] text-tertiary">
        {models.length} agent-ready Cloudflare AI model{models.length === 1 ? "" : "s"}
      </p>
      <label className="mt-4 block text-xs font-medium" htmlFor="teammate-max-steps">
        Maximum steps per message
      </label>
      <div className="relative mt-2">
        <select
          className="h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-9 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-60"
          disabled={saving}
          id="teammate-max-steps"
          value={selectedMaxSteps ?? ""}
          onChange={(event) =>
            void changeMaxSteps(event.target.value ? Number(event.target.value) : null)
          }
        >
          <option value="">Unlimited (default)</option>
          {[8, 16, 32, 64].map((steps) => (
            <option key={steps} value={steps}>
              {steps} steps
            </option>
          ))}
        </select>
        <PiCaretDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-tertiary" />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        One step is one model and tool round. Unlimited continues until the agent replies, waits, or
        stops.
      </p>
      {error ? <p className="mt-2 text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}
