// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopView } from "../../../src/ui/components/details/desktop-view";
import { interact, renderComponent } from "./render.tsx";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  disconnects: 0,
  instances: [] as Array<EventTarget & { viewOnly: boolean }>,
  socketUrls: [] as string[]
}));

vi.mock("../../../src/ui/lib/api", () => ({
  api: mocks.api,
  errorMessage: (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause.message : fallback
}));

vi.mock("@novnc/novnc", () => ({
  default: class FakeRfb extends EventTarget {
    background = "";
    compressionLevel = 0;
    focusOnClick = false;
    qualityLevel = 0;
    scaleViewport = false;
    viewOnly = true;

    constructor(_target: HTMLElement, url: string) {
      super();
      mocks.instances.push(this);
      mocks.socketUrls.push(url);
      queueMicrotask(() => this.dispatchEvent(new Event("connect")));
    }

    disconnect() {
      mocks.disconnects += 1;
    }
  }
}));

function computer(overrides: Record<string, unknown> = {}) {
  return {
    ownerControl: false,
    resources: null,
    running: false,
    ...overrides
  };
}

function captureIntervals() {
  const intervals: Array<{ delay: number; handler: TimerHandler }> = [];
  vi.spyOn(window, "setInterval").mockImplementation((handler, delay) => {
    intervals.push({ delay: Number(delay), handler });
    return intervals.length as never;
  });
  return intervals;
}

function intervalHandler(
  intervals: Array<{ delay: number; handler: TimerHandler }>,
  delay: number
): TimerHandler {
  const handler = intervals.findLast((interval) => interval.delay === delay)?.handler;
  if (!handler) throw new Error(`Missing ${delay} ms interval`);
  return handler;
}

async function runTimer(handler: TimerHandler): Promise<void> {
  await interact(() => {
    if (typeof handler === "function") handler();
  });
}

afterEach(() => {
  mocks.api.mockReset();
  mocks.disconnects = 0;
  mocks.instances = [];
  mocks.socketUrls = [];
  vi.restoreAllMocks();
});

describe("DesktopView", () => {
  it("is passive while the agent computer is off", async () => {
    mocks.api.mockResolvedValueOnce(computer());
    const view = await renderComponent(createElement(DesktopView, { botId: "bot-1" }));

    expect(mocks.api).toHaveBeenCalledWith("/api/bots/bot-1/desktop");
    expect(view.container.textContent).toContain("The agent starts this computer");
    expect(view.container.textContent).toContain("Its live screen appears automatically");
    expect(view.container.textContent).not.toContain("Take control");
    expect(view.container.textContent).not.toContain("Return control");
    expect(view.container.textContent).not.toContain("Economy");
    expect(view.container.textContent).not.toContain("Always on");
    expect(view.container.querySelector('button[aria-label="Open computer"]')).toBeNull();
    expect(view.container.querySelector('button[aria-label="Save and stop computer"]')).toBeNull();
    expect(view.container.querySelector('input[name^="computer-mode-"]')).toBeNull();
    expect(
      view.container.querySelector<HTMLButtonElement>('button[aria-label="Maximize computer"]')
        ?.disabled
    ).toBe(true);
    expect(mocks.socketUrls).toEqual([]);
    await view.unmount();
  });

  it("maximizes the live view-only screen and returns it to the sidebar", async () => {
    mocks.api.mockResolvedValueOnce(computer({ running: true }));
    const view = await renderComponent(createElement(DesktopView, { botId: "bot-1" }));
    const maximize = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Maximize computer"]'
    );

    expect(maximize?.disabled).toBe(false);
    expect(view.container.querySelector('button[aria-label="Save and stop computer"]')).toBeNull();
    expect(view.container.textContent).not.toContain("Take control");
    expect(view.container.querySelector('[aria-label="Linux computer, view only"]')).not.toBeNull();
    await interact(() => maximize?.click());

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Linux computer");
    expect(dialog?.classList.contains("max-lg:h-dvh")).toBe(true);
    expect(dialog?.classList.contains("max-lg:w-screen")).toBe(true);
    expect(dialog?.querySelector('[aria-label="Linux computer, view only"]')).not.toBeNull();
    expect(mocks.socketUrls).toEqual([
      "ws://localhost:3000/api/bots/bot-1/desktop/ws",
      "ws://localhost:3000/api/bots/bot-1/desktop/ws"
    ]);

    const close = [...(dialog?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Close")
    );
    await interact(() => close?.click());

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.socketUrls).toHaveLength(3);
    expect(view.container.querySelector('[aria-label="Linux computer, view only"]')).not.toBeNull();
    await view.unmount();
  });

  it("polls an active off computer each second and attaches when the agent starts it", async () => {
    const intervals = captureIntervals();
    mocks.api.mockResolvedValueOnce(computer()).mockResolvedValueOnce(computer({ running: true }));
    const view = await renderComponent(
      createElement(DesktopView, { active: true, botId: "bot-1" })
    );

    expect(intervals.some((interval) => interval.delay === 1_000)).toBe(true);
    expect(mocks.socketUrls).toEqual([]);

    await runTimer(intervalHandler(intervals, 1_000));

    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.socketUrls).toEqual(["ws://localhost:3000/api/bots/bot-1/desktop/ws"]);
    expect(view.container.querySelector('[aria-label="Linux computer, view only"]')).not.toBeNull();
    expect(view.container.textContent).toContain("View only. Ask the agent if you need control.");
    expect(intervals.filter((interval) => interval.delay === 1_000)).toHaveLength(1);
    await view.unmount();
  });

  it("refreshes when fast agent activity ends before its first poll", async () => {
    mocks.api.mockResolvedValueOnce(computer()).mockResolvedValueOnce(computer({ running: true }));
    const view = await renderComponent(
      createElement(DesktopView, { active: true, botId: "bot-1" })
    );

    await view.rerender(createElement(DesktopView, { active: false, botId: "bot-1" }));

    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.socketUrls).toEqual(["ws://localhost:3000/api/bots/bot-1/desktop/ws"]);
    expect(view.container.querySelector('[aria-label="Linux computer, view only"]')).not.toBeNull();
    await view.unmount();
  });

  it("does not start another status request while one is pending", async () => {
    const intervals = captureIntervals();
    let finishPoll: (status: ReturnType<typeof computer>) => void = () => undefined;
    const pending = new Promise<ReturnType<typeof computer>>((resolve) => {
      finishPoll = resolve;
    });
    mocks.api.mockResolvedValueOnce(computer()).mockReturnValueOnce(pending);
    const view = await renderComponent(
      createElement(DesktopView, { active: true, botId: "bot-1" })
    );
    const poll = intervalHandler(intervals, 1_000);

    await runTimer(poll);
    await runTimer(poll);

    expect(mocks.api).toHaveBeenCalledTimes(2);
    finishPoll(computer());
    await interact();
    await view.unmount();
  });

  it("uses the 15-second fallback while an idle computer stays off", async () => {
    const intervals = captureIntervals();
    mocks.api.mockResolvedValueOnce(computer()).mockResolvedValueOnce(computer());
    const view = await renderComponent(createElement(DesktopView, { botId: "bot-1" }));

    expect(intervals.some((interval) => interval.delay === 1_000)).toBe(false);
    await runTimer(intervalHandler(intervals, 15_000));

    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.socketUrls).toEqual([]);
    expect(view.container.textContent).toContain(
      "The agent starts the computer when work needs it."
    );
    await view.unmount();
  });

  it("uses agent-granted owner control and only renews its lease after 30 seconds", async () => {
    const intervals = captureIntervals();
    mocks.api
      .mockResolvedValueOnce(computer({ ownerControl: true, running: true }))
      .mockResolvedValueOnce(computer({ ownerControl: true, running: true }));
    const view = await renderComponent(createElement(DesktopView, { botId: "bot-1" }));

    expect(mocks.instances[0]?.viewOnly).toBe(false);
    expect(
      view.container.querySelector('[aria-label="Interactive Linux computer"]')
    ).not.toBeNull();
    expect(view.container.textContent).toContain("Tell the agent when you are done.");
    expect(view.container.textContent).not.toContain("Take control");
    expect(view.container.textContent).not.toContain("Return control");
    expect(mocks.api).toHaveBeenCalledTimes(1);

    await runTimer(intervalHandler(intervals, 30_000));

    expect(mocks.api).toHaveBeenLastCalledWith("/api/bots/bot-1/desktop", {
      method: "PATCH",
      body: JSON.stringify({ ownerControl: true })
    });
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.instances[0]?.viewOnly).toBe(false);
    await view.unmount();
  });

  it("keeps agent-granted owner control while the desktop reconnects", async () => {
    const intervals = captureIntervals();
    mocks.api
      .mockResolvedValueOnce(computer({ ownerControl: true, running: true }))
      .mockResolvedValueOnce(computer({ ownerControl: true, running: true }));
    const view = await renderComponent(createElement(DesktopView, { botId: "bot-1" }));

    expect(mocks.instances[0]?.viewOnly).toBe(false);
    await interact(() => mocks.instances[0]?.dispatchEvent(new Event("disconnect")));

    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.disconnects).toBe(1);
    expect(view.container.textContent).toContain("The computer disconnected");

    await runTimer(intervalHandler(intervals, 15_000));
    await interact(() => mocks.instances.at(-1)?.dispatchEvent(new Event("connect")));

    expect(mocks.socketUrls).toHaveLength(2);
    expect(
      view.container.querySelector('[aria-label="Interactive Linux computer"]')
    ).not.toBeNull();
    expect(view.container.textContent).not.toContain("The computer disconnected");
    await view.unmount();
  });

  it("shows resource readings and refreshes them every 15 seconds while running", async () => {
    const intervals = captureIntervals();
    mocks.api
      .mockResolvedValueOnce(
        computer({
          resources: {
            cpuPercent: 12.5,
            diskBytes: 1_073_741_824,
            diskLimitBytes: 10_737_418_240,
            estimatedCostUsd: 0.42,
            memoryBytes: 536_870_912,
            memoryLimitBytes: 2_147_483_648,
            uptimeSeconds: 93_780
          },
          running: true
        })
      )
      .mockResolvedValueOnce(
        computer({
          resources: {
            cpuPercent: 18,
            diskBytes: 1_073_741_824,
            estimatedCostUsd: 0.43,
            memoryBytes: 536_870_912,
            uptimeSeconds: 93_840
          },
          running: true
        })
      );
    const view = await renderComponent(createElement(DesktopView, { botId: "bot-1" }));

    expect(view.container.textContent).toContain("12.5%");
    expect(view.container.textContent).toContain("512 MiB / 2 GiB");
    expect(view.container.textContent).toContain("1 GiB / 10 GiB");
    expect(view.container.textContent).toContain("1d 2h");
    expect(view.container.textContent).toContain("$0.42");

    await runTimer(intervalHandler(intervals, 15_000));

    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toContain("18%");
    expect(view.container.textContent).toContain("$0.43");
    await view.unmount();
  });
});
