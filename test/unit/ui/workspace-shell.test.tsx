// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceController } from "../../../src/ui/hooks/use-workspace";
import { interact, renderComponent } from "./render";

vi.mock("../../../src/ui/components/conversation-panel", () => ({
  ConversationPanel: () => <div data-conversation-panel />
}));
vi.mock("../../../src/ui/components/details/details-panel", () => ({
  DetailsPanel: () => <div data-details-panel />
}));
vi.mock("../../../src/ui/components/teammate-sidebar", () => ({
  TeammateSidebar: ({ header }: { header: ReactNode }) => <div data-teammate-sidebar>{header}</div>
}));

import { WorkspaceShell } from "../../../src/ui/components/workspace-shell";

vi.mock("../../../src/ui/components/projects/projects-page", () => ({
  ProjectsPage: () => <div data-page="projects" />
}));
vi.mock("../../../src/ui/components/settings/settings-page", () => ({
  SettingsPage: () => <div data-page="settings" />
}));
vi.mock("../../../src/ui/components/search/search-page", () => ({
  SearchPage: () => <div data-page="search" />
}));
afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

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

it("restores workspace pages and supports keyboard search and browser navigation", async () => {
  window.history.replaceState(null, "", "/?page=projects");
  vi.spyOn(window, "matchMedia").mockReturnValue({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matches: false
  } as unknown as MediaQueryList);
  const controller = {
    snapshot: { archivedBots: [], bots: [] },
    selectedBot: null,
    setMobileChatOpen: vi.fn()
  } as unknown as WorkspaceController;
  const view = await renderComponent(<WorkspaceShell controller={controller} />);
  await vi.waitFor(() =>
    expect(view.container.querySelector('[data-page="projects"]')).not.toBeNull()
  );
  expect(view.container.querySelector('[data-page="projects"]')).not.toBeNull();
  await interact(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true })
    );
  });
  expect(new URL(window.location.href).searchParams.get("page")).toBe("search");
  await interact(() => {
    [...view.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Settings"))
      ?.click();
  });
  expect(new URL(window.location.href).searchParams.get("page")).toBe("settings");
  window.history.replaceState(null, "", "/?page=projects");
  await interact(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(view.container.querySelector('[data-page="projects"]')).not.toBeNull();
  await view.unmount();
});
