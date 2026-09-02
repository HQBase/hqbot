// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { ConversationHeader } from "../../../src/ui/components/conversation-header";
import { renderComponent } from "./render";

describe("ConversationHeader", () => {
  it("leaves teammate editing in the details sidebar", async () => {
    const bot = { id: "bot-1", name: "Milo" } as BotTeammate;
    const view = await renderComponent(
      <ConversationHeader
        bot={bot}
        showBack={false}
        status="Live"
        working={false}
        onBack={vi.fn()}
        onDetails={vi.fn()}
        onStop={vi.fn()}
      />
    );

    expect(view.container.textContent).toContain("Milo");
    expect(view.container.querySelector('[aria-label="Edit teammate"]')).toBeNull();
    await view.unmount();
  });
});
