// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { RoutineDialog } from "../../../src/ui/components/dialogs/routine-dialog";
import { renderComponent } from "./render.tsx";

const bot = {
  brief: "",
  createdAt: "2026-08-30T12:00:00.000Z",
  dailyBudgetUsd: 1,
  description: "",
  hidden: false,
  id: "bot-1",
  lastInteractedAt: null,
  lastMessage: null,
  maxSteps: null,
  modelId: null,
  name: "Research",
  pinned: false,
  status: "idle",
  title: "Research teammate",
  updatedAt: "2026-08-30T12:00:00.000Z"
} satisfies BotTeammate;

afterEach(() => {
  document.body.textContent = "";
});

describe("RoutineDialog", () => {
  it("offers useful repeat intervals from one minute to 30 days", async () => {
    const view = await renderComponent(
      <RoutineDialog bot={bot} open onChanged={vi.fn()} onOpenChange={vi.fn()} />
    );
    const select = document.body.querySelector<HTMLSelectElement>("#routine-interval");
    if (!select) throw new Error("The routine interval selector did not render");

    expect(select.value).toBe("1440");
    expect([...select.options].map((option) => [option.value, option.text])).toEqual([
      ["1", "1 minute"],
      ["5", "5 minutes"],
      ["15", "15 minutes"],
      ["30", "30 minutes"],
      ["60", "1 hour"],
      ["360", "6 hours"],
      ["720", "12 hours"],
      ["1440", "1 day"],
      ["10080", "1 week"],
      ["43200", "30 days"]
    ]);
    await view.unmount();
  });
});
