// @vitest-environment happy-dom

import { PiInfo } from "react-icons/pi";
import { describe, expect, it } from "vitest";

import { DetailsSection } from "../../../src/ui/components/details/details-section";
import { interact, renderComponent } from "./render";

describe("DetailsSection", () => {
  it("animates an accessible collapsible section", async () => {
    const view = await renderComponent(
      <DetailsSection badge={2} icon={PiInfo} title="Files">
        <button type="button">Open file</button>
      </DetailsSection>
    );
    const trigger = view.container.querySelector<HTMLButtonElement>("button[aria-expanded]");
    const content = [...view.container.querySelectorAll<HTMLElement>("[id]")].find(
      (element) => element.id === trigger?.getAttribute("aria-controls")
    );

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(content?.hasAttribute("inert")).toBe(true);
    await interact(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(content?.hasAttribute("inert")).toBe(false);
    await view.unmount();
  });
});
