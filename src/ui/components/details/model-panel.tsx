import { useEffect, useState } from "react";
import { PiCaretDown, PiCpu } from "react-icons/pi";

import { HQBOT_MODELS, type HQBotModelId, normalizeHQBotModelId } from "../../../domain/models";
import { DetailsSection } from "./details-section";

export function ModelPanel({
  modelId,
  onModelChange
}: {
  modelId: string | null;
  onModelChange: (modelId: HQBotModelId) => Promise<void>;
}) {
  const persisted = normalizeHQBotModelId(modelId);
  const [selected, setSelected] = useState<HQBotModelId>(persisted);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setSelected(persisted), [persisted]);

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

  return (
    <DetailsSection badge={saving ? "Saving" : "Config"} defaultOpen icon={PiCpu} title="Model">
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
          {HQBOT_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        <PiCaretDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-tertiary" />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        {HQBOT_MODELS.find((model) => model.id === selected)?.description}
      </p>
      {error ? <p className="mt-2 text-[11px] text-destructive">{error}</p> : null}
    </DetailsSection>
  );
}
