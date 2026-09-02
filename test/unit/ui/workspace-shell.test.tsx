// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceController } from "../../../src/ui/hooks/use-workspace";
import { renderComponent } from "./render";

vi.mock("../../../src/ui/components/conversation-panel", () => ({
  ConversationPanel: () => <div data-conversation-panel />
}));
vi.mock("../../../src/ui/components/details/details-panel", () => ({
  DetailsPanel: () => <div data-details-panel />
}));
vi.mock("../../../src/ui/components/teammate-sidebar", () => ({
  TeammateSidebar: () => <div data-teammate-sidebar />
}));

import { WorkspaceShell } from "../../../src/ui/components/workspace-shell";

afterEach(() => vi.restoreAllMocks());

describe("WorkspaceShell", () => {
  it("mounts only one live conversation on desktop", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn()
    } as unknown as MediaQueryList);
    const controller = {
      snapshot: { archivedBots: [], bots: [] },
      selectedBot: null
    } as unknown as WorkspaceController;

    const view = await renderComponent(<WorkspaceShell controller={controller} />);

    expect(view.container.querySelectorAll("[data-conversation-panel]")).toHaveLength(1);
    await view.unmount();
  });
});
