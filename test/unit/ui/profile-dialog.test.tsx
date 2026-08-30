// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { ProfileDialog } from "../../../src/ui/components/dialogs/profile-dialog";
import { interact, renderComponent } from "./render.tsx";

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
  modelId: "@cf/zai-org/glm-5.3-flash",
  dailyBudgetUsd: 2,
  createdAt: "2026-08-30T12:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z",
  connection: null
} satisfies BotTeammate;

afterEach(() => {
  document.body.textContent = "";
});

describe("ProfileDialog", () => {
  it("requires confirmation before it deletes a teammate", async () => {
    const onDeleted = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();
    const view = await renderComponent(
      <ProfileDialog
        bot={bot}
        open
        onDeleted={onDeleted}
        onOpenChange={onOpenChange}
        onSaved={async () => undefined}
      />
    );
    const button = (label: string) =>
      [...document.body.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === label
      );

    await interact(() => button("Delete")?.click());
    expect(document.body.textContent).toContain("Delete Research?");
    expect(document.body.textContent).toContain("This cannot be undone.");
    expect(onDeleted).not.toHaveBeenCalled();

    await interact(() => button("Delete teammate")?.click());
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await view.unmount();
  });
});
