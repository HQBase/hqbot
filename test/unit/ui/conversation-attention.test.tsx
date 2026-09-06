// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  ConversationAttention,
  OwnerActionCards
} from "../../../src/ui/components/chat/conversation-attention";
import { interact, renderComponent } from "./render";

vi.mock("../../../src/ui/components/details/desktop-view", () => ({
  DesktopView: ({ botId }: { botId: string }) => (
    <div role="application">Live computer for {botId}</div>
  )
}));
afterEach(() => vi.unstubAllGlobals());
const item = {
  botId: "specialist",
  name: "Source",
  computerApprovals: [
    {
      executionId: "open",
      inputHash: "hash",
      action: "browser_open",
      input: { url: "https://example.com" }
    }
  ],
  integrationApprovals: [],
  handoff: { id: "login", state: "pending", ownerControl: true, running: true }
};
it("shows a specialist approval and the interactive computer in the initiating conversation", async () => {
  const decide = vi.fn(async (_key: string, _body: unknown) => undefined);
  const view = await renderComponent(
    <OwnerActionCards item={item} disabled={false} busy={null} decide={decide} />
  );
  expect(view.container.textContent).toContain("Source");
  expect(view.container.querySelector('[role="application"]')?.textContent).toContain("specialist");
  await interact(() =>
    [...view.container.querySelectorAll("button")]
      .find((button) => button.textContent === "Approve")
      ?.click()
  );
  expect(decide).toHaveBeenLastCalledWith("specialist:open", {
    botId: "specialist",
    kind: "computer",
    id: "open",
    inputHash: "hash",
    approved: true
  });
  await interact(() =>
    [...view.container.querySelectorAll("button")]
      .find((button) => button.textContent === "I’m done—continue")
      ?.click()
  );
  expect(decide).toHaveBeenLastCalledWith("specialist:login", {
    botId: "specialist",
    kind: "continue",
    id: "login"
  });
  await view.unmount();
});
it("offers reconnect after a lease expires and disables duplicate decisions while pending", async () => {
  const decide = vi.fn(async () => undefined);
  const view = await renderComponent(
    <OwnerActionCards
      item={{ ...item, handoff: { ...item.handoff, ownerControl: false } }}
      disabled
      busy="specialist:login"
      decide={decide}
    />
  );
  expect(view.container.textContent).toContain("Reconnect computer");
  expect([...view.container.querySelectorAll("button")].every((button) => button.disabled)).toBe(
    true
  );
  expect(view.container.querySelector('[role="application"]')).toBeNull();
  await view.unmount();
});
it("keeps the last request visible but disabled after a failed refresh", async () => {
  const fetcher = vi.fn(async () => Response.json({ items: [item] }));
  vi.stubGlobal("fetch", fetcher);
  const view = await renderComponent(<ConversationAttention botId="chief" />);
  expect(view.container.textContent).toContain("Source");
  fetcher.mockResolvedValue(Response.json({ error: "Disconnected" }, { status: 503 }));
  await interact(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(view.container.textContent).toContain("Disconnected");
  expect(
    [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Approve"
    )?.disabled
  ).toBe(true);
  await view.unmount();
});
it("shows the named control and reason instead of raw references, with technical details collapsed", async () => {
  const view = await renderComponent(
    <OwnerActionCards
      item={{
        ...item,
        handoff: null,
        computerApprovals: [
          {
            executionId: "send",
            action: "browser_click",
            input: { ref: "e4" },
            inputHash: "hash",
            review: {
              title: "Click “Send email”",
              reason: "This sends a message to another person.",
              details: "Mail · https://mail.example",
              decision: "review"
            }
          }
        ]
      }}
      disabled={false}
      busy={null}
      decide={vi.fn(async () => undefined)}
    />
  );
  expect(view.container.textContent).toContain("Click “Send email”");
  expect(view.container.textContent).toContain("This sends a message");
  const details = view.container.querySelector("details");
  expect(details?.open).toBe(false);
  expect(details?.textContent).toContain('"ref": "e4"');
  expect(view.container.querySelector('[aria-label="Action details"]')?.textContent).not.toContain(
    "e4"
  );
  await view.unmount();
});
