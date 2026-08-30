// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { DEEPSEEK_FALLBACK_MODEL_ID, GLM_PRIMARY_MODEL_ID } from "../../../src/domain/models";
import { ModelPanel } from "../../../src/ui/components/details/model-panel";
import { interact, renderComponent } from "./render";

describe("ModelPanel", () => {
  it("shows the saved model and changes it with the exact model ID", async () => {
    const onModelChange = vi.fn(async () => undefined);
    const view = await renderComponent(
      <ModelPanel modelId={GLM_PRIMARY_MODEL_ID} onModelChange={onModelChange} />
    );
    const select = view.container.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("The model selector did not render");

    expect(select.value).toBe(GLM_PRIMARY_MODEL_ID);
    expect(view.container.textContent).toContain("GLM 5.3 Flash");
    expect(view.container.textContent).toContain("DeepSeek V4 Flash");
    await interact(() => {
      select.value = DEEPSEEK_FALLBACK_MODEL_ID;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onModelChange).toHaveBeenCalledWith(DEEPSEEK_FALLBACK_MODEL_ID);
    await view.unmount();
  });
});
