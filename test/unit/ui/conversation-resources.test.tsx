// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationsPage } from "../../../src/ui/components/automations/automations-page";
import { LibraryPage } from "../../../src/ui/components/library/library-page";
import type { WorkspaceController } from "../../../src/ui/hooks/use-workspace";
import { renderComponent } from "./render";

afterEach(() => vi.unstubAllGlobals());
const controller = {
  selectedBot: { id: "one", name: "Milo" },
  snapshot: {
    bots: [
      { id: "one", name: "Milo" },
      { id: "two", name: "Willow" }
    ]
  }
} as unknown as WorkspaceController;

describe("conversation resources", () => {
  it("loads only the selected teammate's memory and keeps the teammate picker out of info", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        items: [
          {
            id: "memory",
            kind: "memory",
            content: "Use short replies",
            revision: 1,
            source: "Owner"
          },
          {
            id: "skill",
            kind: "skill",
            name: "Research",
            description: "Search official sources",
            instructions: "Read",
            revision: 1,
            status: "ready"
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetch);
    const view = await renderComponent(
      <LibraryPage controller={controller} scope={{ botId: "one", kind: "memory" }} />
    );
    expect(fetch).toHaveBeenCalledWith("/api/bots/one/knowledge", expect.anything());
    expect(view.container.textContent).toContain("Use short replies");
    expect(view.container.textContent).not.toContain("Search official sources");
    expect(view.container.querySelector('[aria-label="Library teammate"]')).toBeNull();
    expect(view.container.textContent).not.toContain("Record a skill");
    await view.unmount();
  });

  it("shows only the selected teammate's routines in conversation info", async () => {
    const routine = {
      id: "morning",
      botId: "one",
      name: "Morning brief",
      active: false,
      schedule: { kind: "interval", minutes: 60 }
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          routines: [
            routine,
            { ...routine, id: "other", botId: "two", name: "Private routine for Willow" }
          ]
        })
      )
    );
    const view = await renderComponent(
      <AutomationsPage controller={controller} scopeBotId="one" onConversation={vi.fn()} />
    );
    expect(view.container.textContent).toContain("Morning brief");
    expect(view.container.textContent).not.toContain("Private routine for Willow");
    await view.unmount();
  });
});
