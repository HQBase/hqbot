// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveView } from "../../../src/ui/components/details/live-view";
import { interact, renderComponent } from "./render.tsx";

const liveAgent = vi.hoisted(() => ({
  closeLiveView: vi.fn(),
  getLiveView: vi.fn()
}));

vi.mock("agents/react", () => ({
  useAgent: () => ({ stub: liveAgent })
}));

afterEach(() => {
  liveAgent.closeLiveView.mockReset();
  liveAgent.getLiveView.mockReset();
});

describe("LiveView", () => {
  it("does not request a browser session until the owner clicks", async () => {
    liveAgent.getLiveView.mockResolvedValue({
      targets: [{ pageUrl: "https://example.com", url: "https://live.example.com" }]
    });
    const view = await renderComponent(
      createElement(LiveView, {
        botId: "bot-1",
        computer: {
          active: false,
          expiresAt: null,
          screenshotKey: null,
          updatedAt: null,
          url: null
        },
        onStop: vi.fn(),
        task: null
      })
    );

    expect(liveAgent.getLiveView).not.toHaveBeenCalled();
    const openButton = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Open Live View")
    );
    expect(openButton).toBeDefined();

    await interact(() => openButton?.click());
    expect(liveAgent.getLiveView).toHaveBeenCalledOnce();
    expect(liveAgent.getLiveView).toHaveBeenCalledWith("tab");
    expect(view.container.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://live.example.com"
    );
    await view.unmount();
  });
});
