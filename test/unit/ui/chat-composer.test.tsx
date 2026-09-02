// @vitest-environment happy-dom

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { ChatComposer } from "../../../src/ui/components/chat/chat-composer";
import { interact, renderComponent } from "./render.tsx";

function teammate(id: string, name: string): BotTeammate {
  return {
    brief: "",
    createdAt: "2026-08-30T12:00:00.000Z",
    dailyBudgetUsd: 1,
    description: "",
    hidden: false,
    id,
    lastInteractedAt: null,
    lastMessage: null,
    maxSteps: null,
    modelId: null,
    name,
    pinned: false,
    status: "idle",
    title: `${name} teammate`,
    updatedAt: "2026-08-30T12:00:00.000Z"
  };
}

const current = teammate("lead", "Lead");

function ComposerHarness({ onSend = vi.fn() }: { onSend?: () => void }) {
  const [prompt, setPrompt] = useState("");
  return (
    <ChatComposer
      attachedFiles={[]}
      bot={current}
      error=""
      prompt={prompt}
      sending={false}
      uploading={false}
      working={false}
      onConnect={vi.fn()}
      onPromptChange={setPrompt}
      onRemoveFile={vi.fn()}
      onSend={onSend}
      onStop={vi.fn()}
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

describe("ChatComposer", () => {
  it("announces a send error", async () => {
    const view = await renderComponent(
      <ChatComposer
        attachedFiles={[]}
        bot={current}
        error="The message could not be sent"
        prompt=""
        sending={false}
        uploading={false}
        working={false}
        onConnect={vi.fn()}
        onPromptChange={vi.fn()}
        onRemoveFile={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onUpload={vi.fn()}
      />
    );

    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(
      "The message could not be sent"
    );
    await view.unmount();
  });

  it("keeps @ text as normal text without teammate suggestions", async () => {
    const view = await renderComponent(<ComposerHarness />);
    const textarea = view.container.querySelector("textarea");
    if (!textarea) throw new Error("The composer textarea did not render");

    await typeInComposer(textarea, "Ask @Research");

    expect(textarea.value).toBe("Ask @Research");
    expect(view.container.querySelector('[role="option"]')).toBeNull();
    expect(view.container.textContent).not.toContain("Ask a teammate");
    expect(view.container.textContent).not.toContain("@Name");
    await view.unmount();
  });

  it("sends a non-empty message with Enter", async () => {
    const onSend = vi.fn();
    const view = await renderComponent(<ComposerHarness onSend={onSend} />);
    const textarea = view.container.querySelector("textarea");
    if (!textarea) throw new Error("The composer textarea did not render");
    await typeInComposer(textarea, "Hello");

    await interact(() =>
      textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
    );

    expect(onSend).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("shows one Stop action while work is active and the composer is empty", async () => {
    const onStop = vi.fn();
    const view = await renderComponent(
      <ChatComposer
        attachedFiles={[]}
        bot={current}
        error=""
        prompt=""
        sending={false}
        uploading={false}
        working
        onConnect={vi.fn()}
        onPromptChange={vi.fn()}
        onRemoveFile={vi.fn()}
        onSend={vi.fn()}
        onStop={onStop}
        onUpload={vi.fn()}
      />
    );
    const stop = view.container.querySelector<HTMLButtonElement>('button[aria-label="Stop"]');

    expect(stop).not.toBeNull();
    expect(view.container.querySelector('button[aria-label="Send"]')).toBeNull();
    expect(view.container.textContent).toContain("Type a follow-up or stop the current work");
    await interact(() => stop?.click());
    expect(onStop).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("shows a working ring around Send for an active follow-up", async () => {
    const onSend = vi.fn();
    const view = await renderComponent(
      <ChatComposer
        attachedFiles={[]}
        bot={current}
        error=""
        prompt="Change direction"
        sending={false}
        uploading={false}
        working
        onConnect={vi.fn()}
        onPromptChange={vi.fn()}
        onRemoveFile={vi.fn()}
        onSend={onSend}
        onStop={vi.fn()}
        onUpload={vi.fn()}
      />
    );
    const send = view.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]');

    expect(send?.disabled).toBe(false);
    expect(view.container.querySelector('button[aria-label="Stop"]')).toBeNull();
    expect(send?.querySelector('[data-slot="working-send-ring"]')).not.toBeNull();
    expect(view.container.textContent).toContain("Send to redirect the current work");
    await interact(() =>
      view.container
        .querySelector("form")
        ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
    );
    expect(onSend).toHaveBeenCalledOnce();
    await view.unmount();
  });
});
