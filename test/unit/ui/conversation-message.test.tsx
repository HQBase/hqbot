// @vitest-environment happy-dom
import type { UIMessage } from "ai";
import { expect, it, vi } from "vitest";
import { ConversationMessage } from "../../../src/ui/components/chat/conversation-message";
import { labBots } from "../../../src/ui/features/ui-lab/fixtures";
import { renderComponent } from "./render";

it("keeps internal service payloads out of user bubbles while preserving real user messages", async () => {
  const message: UIMessage = {
    id: "integration:run",
    role: "user",
    parts: [{ type: "text", text: "[hqbot:action-result]\nLarge raw service payload" }]
  };
  const props = { bot: labBots[0], onAsk: vi.fn() };
  const view = await renderComponent(<ConversationMessage {...props} message={message} />);
  expect(view.container.textContent).toContain("Connected service update");
  expect(view.container.textContent).toContain("Activity → Actions");
  expect(view.container.textContent).not.toContain("Large raw service payload");
  await view.rerender(
    <ConversationMessage {...props} message={{ ...message, id: "owner-message" }} />
  );
  expect(view.container.textContent).toContain("Large raw service payload");
  await view.unmount();
});
