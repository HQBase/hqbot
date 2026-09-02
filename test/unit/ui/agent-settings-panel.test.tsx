// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { AgentSettingsPanel } from "../../../src/ui/components/details/agent-settings-panel";
import { interact, renderComponent } from "./render";

const bot = {
  id: "bot-1",
  name: "Research",
  title: "Researcher",
  description: "Finds evidence.",
  brief: "Research requests",
  pinned: false,
  hidden: false,
  status: "idle",
  lastInteractedAt: null,
  lastMessage: null,
  maxSteps: null,
  modelId: "@cf/zai-org/glm-5.3-flash",
  dailyBudgetUsd: 2,
  createdAt: "2026-08-30T12:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z"
} satisfies BotTeammate;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AgentSettingsPanel", () => {
  it("keeps every teammate control in one collapsed section", async () => {
    const onDeleted = vi.fn(async () => undefined);
    const view = await renderComponent(
      <AgentSettingsPanel
        bot={bot}
        loadCatalog={false}
        onDeleted={onDeleted}
        onMaxStepsChange={vi.fn()}
        onModelChange={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    const button = (label: string) =>
      [...view.container.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === label
      );
    const toggle = button("Agent settingsConfig");

    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.querySelector("#teammate-name")).not.toBeNull();
    expect(view.container.querySelector("#teammate-title")).toBeNull();
    expect(view.container.querySelector("#teammate-model")).not.toBeNull();
    expect(button("Pin")).toBeUndefined();
    expect(button("Duplicate")).toBeUndefined();

    await interact(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");

    await interact(() => button("Delete")?.click());
    expect(view.container.textContent).toContain("Delete Research?");
    expect(view.container.textContent).toContain("This cannot be undone.");
    expect(onDeleted).not.toHaveBeenCalled();

    await interact(() => button("Delete teammate")?.click());
    expect(onDeleted).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
