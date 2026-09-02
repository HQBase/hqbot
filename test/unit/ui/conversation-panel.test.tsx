// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationPanel } from "../../../src/ui/components/conversation-panel";
import type { WorkspaceController } from "../../../src/ui/hooks/use-workspace";
import { renderComponent } from "./render.tsx";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConversationPanel", () => {
  it("shows the first message while the teammate is being created", async () => {
    const controller = {
      error: "",
      newTeammate: true,
      pendingInitialMessage: { botId: null, text: "hey how are you?" },
      selectedBot: null,
      sending: true,
      setDetailsOpen: vi.fn(),
      setMobileChatOpen: vi.fn()
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <ConversationPanel
        controller={controller}
        prompt="hey how are you?"
        onPromptChange={() => undefined}
      />
    );

    expect(view.container.querySelector('[role="log"]')?.textContent).toContain("hey how are you?");
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Thinking");
    expect(view.container.textContent).not.toContain("Inbox manager");
    expect(view.container.querySelector("textarea")).toBeNull();
    await view.unmount();
  });

  it("does not show a composer before a teammate exists", async () => {
    const controller = {
      error: "",
      newTeammate: false,
      pendingInitialMessage: null,
      selectedBot: null,
      sending: false,
      setDetailsOpen: vi.fn(),
      setMobileChatOpen: vi.fn()
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <ConversationPanel controller={controller} prompt="" onPromptChange={() => undefined} />
    );

    expect(view.container.textContent).toContain("Create a teammate");
    expect(view.container.querySelector("textarea")).toBeNull();
    await view.unmount();
  });
});
