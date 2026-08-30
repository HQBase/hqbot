// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { ThemeProvider } from "../../../src/ui/features/theme/theme-provider";
import { AgentUiLab } from "../../../src/ui/features/ui-lab/agent-ui-lab";
import { interact, renderComponent } from "./render.tsx";

describe("AgentUiLab", () => {
  it("renders the real shell and all fixed state controls", async () => {
    const view = await renderComponent(
      <ThemeProvider initialTheme="light">
        <AgentUiLab />
      </ThemeProvider>
    );

    expect(view.container.textContent).toContain("Researcher");
    expect(view.container.textContent).toContain("Review this reply");
    for (const label of ["Shell", "Streaming", "Reconnecting", "Error", "Mobile"]) {
      expect(
        [...view.container.querySelectorAll("button")].some(
          (button) => button.textContent === label
        )
      ).toBe(true);
    }
    await view.unmount();
  });

  it("switches between reconnecting, error, and mobile previews", async () => {
    const view = await renderComponent(
      <ThemeProvider initialTheme="light">
        <AgentUiLab />
      </ThemeProvider>
    );
    const click = async (label: string) => {
      const button = [...view.container.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === label
      );
      await interact(() =>
        button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      );
    };

    await click("Reconnecting");
    expect(view.container.textContent).toContain("Recovering");
    expect(view.container.textContent).toContain("HQBot is reconnecting");

    await click("Error");
    expect(view.container.textContent).toContain("Offline");
    expect(view.container.textContent).toContain(
      "Browser Run session ended before the page loaded"
    );

    await click("Mobile");
    expect(view.container.querySelector('[aria-label="Mobile frame"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Open teammates sidebar"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Open details sidebar"]')).not.toBeNull();
    await view.unmount();
  });
});
