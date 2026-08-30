// @vitest-environment happy-dom

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { ChatComposer } from "../../../src/ui/components/chat/chat-composer";
import { interact, renderComponent } from "./render.tsx";

function teammate(id: string, name: string, hidden = false): BotTeammate {
  return {
    brief: "",
    connection: null,
    createdAt: "2026-08-30T12:00:00.000Z",
    dailyBudgetUsd: 1,
    description: "",
    hidden,
    id,
    lastInteractedAt: null,
    lastMessage: null,
    modelId: null,
    name,
    pinned: false,
    status: "idle",
    title: `${name} teammate`,
    updatedAt: "2026-08-30T12:00:00.000Z"
  };
}

const current = teammate("lead", "Lead");
const research = teammate("research", "Research");
const writer = teammate("writer", "Writer");
const archived = teammate("old", "Old", true);

function ComposerHarness({ onSend = vi.fn() }: { onSend?: () => void }) {
  const [prompt, setPrompt] = useState("");
  return (
    <ChatComposer
      attachedFiles={[]}
      bot={current}
      error=""
      prompt={prompt}
      sending={false}
      teammates={[current, research, writer, archived]}
      uploading={false}
      onConnect={vi.fn()}
      onPromptChange={setPrompt}
      onRemoveFile={vi.fn()}
      onSend={onSend}
      onUpload={vi.fn()}
    />
  );
}

async function typeInComposer(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await interact(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.setSelectionRange(value.length, value.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ChatComposer teammate mentions", () => {
  it("suggests matching active peers and explains the shortcut", async () => {
    const view = await renderComponent(<ComposerHarness />);
    const textarea = view.container.querySelector("textarea");
    if (!textarea) throw new Error("The composer textarea did not render");

    expect(view.container.textContent).toContain("@Name to ask a teammate");
    await typeInComposer(textarea, "Ask @re");

    const options = [...view.container.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(["@ResearchResearch teammate"]);
    expect(view.container.textContent).not.toContain("@Old");
    expect(view.container.textContent).not.toContain("@Lead");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    await view.unmount();
  });

  it("uses arrow keys and Enter to insert an exact teammate name without sending", async () => {
    const onSend = vi.fn();
    const view = await renderComponent(<ComposerHarness onSend={onSend} />);
    const textarea = view.container.querySelector("textarea");
    if (!textarea) throw new Error("The composer textarea did not render");
    await typeInComposer(textarea, "@");

    await interact(() =>
      textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }))
    );
    await interact(() =>
      textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
    );

    expect(textarea.value).toBe("@Writer ");
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
    await view.unmount();
  });
});
