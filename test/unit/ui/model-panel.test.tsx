// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEEPSEEK_FALLBACK_MODEL_ID,
  GLM_PRIMARY_MODEL_ID,
  HQBOT_MODELS
} from "../../../src/domain/models";
import { ModelPanel } from "../../../src/ui/components/details/model-panel";
import { interact, renderComponent } from "./render";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModelPanel", () => {
  it("shows the saved model and changes it with the exact model ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ models: HQBOT_MODELS })))
    );
    const onModelChange = vi.fn(async () => undefined);
    const onMaxStepsChange = vi.fn(async () => undefined);
    const view = await renderComponent(
      <ModelPanel
        maxSteps={null}
        modelId={GLM_PRIMARY_MODEL_ID}
        onMaxStepsChange={onMaxStepsChange}
        onModelChange={onModelChange}
      />
    );
    const modelSelect = view.container.querySelector<HTMLSelectElement>("#teammate-model");
    const stepsSelect = view.container.querySelector<HTMLSelectElement>("#teammate-max-steps");
    if (!modelSelect || !stepsSelect) throw new Error("The agent settings did not render");

    expect(modelSelect.value).toBe(GLM_PRIMARY_MODEL_ID);
    expect(stepsSelect.value).toBe("");
    expect(view.container.textContent).toContain("Unlimited (default)");
    expect(view.container.textContent).toContain("GLM 5.3 Flash");
    expect(view.container.textContent).toContain("DeepSeek V4 Flash");
    expect(view.container.textContent).not.toContain(HQBOT_MODELS[0]?.description);
    await interact(() => {
      modelSelect.value = DEEPSEEK_FALLBACK_MODEL_ID;
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onModelChange).toHaveBeenCalledWith(DEEPSEEK_FALLBACK_MODEL_ID);
    await interact(() => {
      stepsSelect.value = "16";
      stepsSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onMaxStepsChange).toHaveBeenCalledWith(16);
    await view.unmount();
  });

  it("loads every agent-ready model returned by Cloudflare AI", async () => {
    const catalog = [
      ...HQBOT_MODELS,
      {
        ...HQBOT_MODELS[0],
        id: "openai/test-tool-model" as const,
        label: "Test Tool Model"
      }
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ models: catalog })))
    );
    const view = await renderComponent(
      <ModelPanel
        maxSteps={null}
        modelId={GLM_PRIMARY_MODEL_ID}
        onMaxStepsChange={vi.fn()}
        onModelChange={vi.fn()}
      />
    );
    await interact();

    expect(view.container.textContent).toContain("Test Tool Model");
    expect(view.container.querySelector('optgroup[label="Workers AI"]')).not.toBeNull();
    expect(view.container.querySelector('optgroup[label="AI Gateway"]')).not.toBeNull();
    expect(view.container.textContent).toContain(
      `${HQBOT_MODELS.length + 1} agent-ready Cloudflare AI models`
    );
    await view.unmount();
  });
});
