// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveView } from "../../../src/ui/components/details/live-view";
import { interact, renderComponent } from "./render.tsx";

const liveAgents = vi.hoisted(() => ({
  "bot-1": { closeLiveView: vi.fn(), getLiveView: vi.fn(), keepLiveViewAlive: vi.fn() },
  "bot-2": { closeLiveView: vi.fn(), getLiveView: vi.fn(), keepLiveViewAlive: vi.fn() }
}));

vi.mock("agents/react", () => ({
  useAgent: ({ name }: { name: keyof typeof liveAgents }) => ({ stub: liveAgents[name] })
}));

afterEach(() => {
  for (const agent of Object.values(liveAgents)) {
    agent.closeLiveView.mockReset();
    agent.getLiveView.mockReset();
    agent.keepLiveViewAlive.mockReset();
  }
  vi.restoreAllMocks();
});

describe("LiveView", () => {
  it("does not request a browser session until the owner clicks", async () => {
    liveAgents["bot-1"].getLiveView.mockResolvedValue({
      sessionId: "session-1",
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
        task: null
      })
    );

    expect(liveAgents["bot-1"].getLiveView).not.toHaveBeenCalled();
    const openButton = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Open Live View")
    );
    expect(openButton).toBeDefined();

    await interact(() => openButton?.click());
    expect(liveAgents["bot-1"].getLiveView).toHaveBeenCalledOnce();
    expect(liveAgents["bot-1"].getLiveView).toHaveBeenCalledWith("tab");
    expect(view.container.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://live.example.com"
    );
    await view.unmount();
  });

  it("stops only the selected teammate browser session", async () => {
    const view = await renderComponent(
      createElement(LiveView, {
        botId: "bot-2",
        computer: {
          active: true,
          expiresAt: null,
          screenshotKey: null,
          updatedAt: null,
          url: "https://example.com"
        },
        task: null
      })
    );
    const stopButton = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Stop")
    );

    await interact(() => stopButton?.click());

    expect(liveAgents["bot-2"].closeLiveView).toHaveBeenCalledOnce();
    expect(liveAgents["bot-1"].closeLiveView).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("keeps an open Live View session alive every 30 seconds", async () => {
    let heartbeat: TimerHandler | undefined;
    vi.spyOn(window, "setInterval").mockImplementation((handler) => {
      heartbeat = handler;
      return 1 as never;
    });
    liveAgents["bot-1"].getLiveView.mockResolvedValue({
      sessionId: "session-1",
      targets: [{ pageUrl: "https://example.com", url: "https://live.example.com" }]
    });
    liveAgents["bot-1"].keepLiveViewAlive.mockResolvedValue(true);
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
        task: null
      })
    );
    const openButton = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Open Live View")
    );
    await interact(() => openButton?.click());
    await interact(() => {
      if (typeof heartbeat === "function") heartbeat();
    });

    expect(window.setInterval).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(liveAgents["bot-1"].keepLiveViewAlive).toHaveBeenCalledWith("session-1", undefined);
    await view.unmount();
  });
});
