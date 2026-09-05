// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { ConversationHeader } from "../../../src/ui/components/conversation-header";
import { interact, renderComponent } from "./render";

describe("ConversationHeader", () => {
  it("leaves teammate editing in the details sidebar", async () => {
    const bot = { id: "bot-1", name: "Milo" } as BotTeammate;
    const onDetails = vi.fn();
    const onComputer = vi.fn();
    const view = await renderComponent(
      <ConversationHeader
        bot={bot}
        showBack={false}
        status="Live"
        working={false}
        onBack={vi.fn()}
        onDetails={onDetails}
        onComputer={onComputer}
        onStop={vi.fn()}
      />
    );

    expect(view.container.textContent).toContain("Milo");
    expect(view.container.querySelector('[aria-label="Edit teammate"]')).toBeNull();
    const computer = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Open computer"]'
    );
    expect(computer?.textContent).toContain("Computer");
    expect(computer?.className).not.toContain("hidden");
    await interact(() => computer?.click());
    expect(onComputer).toHaveBeenCalledOnce();
    expect(onDetails).not.toHaveBeenCalled();
    await interact(() =>
      view.container.querySelector<HTMLButtonElement>('[aria-label="Conversation info"]')?.click()
    );
    await interact(() =>
      view.container.querySelector<HTMLButtonElement>('[aria-label="About Milo"]')?.click()
    );
    expect(onDetails).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});
