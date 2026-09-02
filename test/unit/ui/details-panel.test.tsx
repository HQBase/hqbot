// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DetailsPanel } from "../../../src/ui/components/details/details-panel";
import type { WorkspaceController } from "../../../src/ui/hooks/use-workspace";
import { renderComponent } from "./render";

vi.mock("../../../src/ui/components/details/agent-settings-panel", () => ({
  AgentSettingsPanel: ({ bot }: { bot: { id: string } }) => (
    <span data-settings>{bot.id}-settings-marker</span>
  )
}));
vi.mock("../../../src/ui/components/details/desktop-view", () => ({
  DesktopView: ({ botId }: { botId: string }) => <span>{botId}-computer-marker</span>
}));
vi.mock("../../../src/ui/components/details/resources-panel", () => ({
  ResourcesPanel: () => <span>resources-marker</span>
}));
vi.mock("../../../src/ui/components/details/cost-panel", () => ({
  CostPanel: () => <span>cost-marker</span>
}));

describe("DetailsPanel", () => {
  it("puts cost after every other teammate detail", () => {
    const controller = {
      selectedBot: { dailyBudgetUsd: 1, id: "bot-1", modelId: null },
      selectedTask: null,
      setDialog: vi.fn(),
      setModel: vi.fn(),
      snapshot: {
        costs: {},
        files: [],
        memories: [],
        routines: [],
        skills: []
      }
    } as unknown as WorkspaceController;
    const html = renderToStaticMarkup(
      <DetailsPanel controller={controller} onUseSkill={vi.fn()} />
    );

    for (const marker of ["settings-marker", "computer-marker", "resources-marker"]) {
      expect(html.indexOf("cost-marker")).toBeGreaterThan(html.indexOf(marker));
    }
    expect(html.match(/computer-marker/g)).toHaveLength(1);
    expect(html.endsWith("</aside>")).toBe(true);
  });

  it("replaces teammate details when the selected teammate changes", async () => {
    const controller = {
      selectedBot: { dailyBudgetUsd: 1, id: "bot-1", modelId: null },
      selectedTask: null,
      setDialog: vi.fn(),
      setModel: vi.fn(),
      snapshot: { costs: {}, files: [], memories: [], routines: [], skills: [] }
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <DetailsPanel controller={controller} onUseSkill={vi.fn()} />
    );

    const next = {
      ...controller,
      selectedBot: { ...controller.selectedBot, id: "bot-2" }
    } as WorkspaceController;
    await view.rerender(<DetailsPanel controller={next} onUseSkill={vi.fn()} />);

    expect(view.container.querySelectorAll("[data-settings]")).toHaveLength(1);
    expect(view.container.textContent).toContain("bot-2-settings-marker");
    expect(view.container.textContent).not.toContain("bot-1-settings-marker");
    await view.unmount();
  });
});
