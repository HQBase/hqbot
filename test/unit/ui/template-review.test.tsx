// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { TeammateTemplate } from "../../../src/domain/templates";
import { TemplateReview } from "../../../src/ui/components/library/template-review";
import { interact, renderComponent } from "./render";

const template: TeammateTemplate = {
  format: "hqbot-teammate",
  version: 1,
  profile: {
    name: "Researcher",
    title: "Research",
    description: "Find sources",
    brief: "Compare primary evidence",
    modelId: "test",
    dailyBudgetUsd: 2,
    maxSteps: null
  },
  skills: [],
  routines: []
};
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.textContent = "";
});
it("publishes only after a review action and retries with the same candidate ID", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValue(
      new Response(JSON.stringify({ share: { id: crypto.randomUUID() } }), {
        headers: { "Content-Type": "application/json" }
      })
    );
  vi.stubGlobal("fetch", fetcher);
  const view = await renderComponent(
    <TemplateReview
      template={template}
      canPublish
      onClose={vi.fn()}
      onImported={vi.fn()}
      onShared={vi.fn()}
    />
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Compare primary evidence");
  const publish = () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Publish public link")
      ?.click();
  await interact(publish);
  await interact(publish);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]?.[1].body).toBe(fetcher.mock.calls[1]?.[1].body);
  expect(document.body.textContent).toContain("Public link created");
  await view.unmount();
});
