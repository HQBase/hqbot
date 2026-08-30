// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { RealtimeConversation } from "../../../src/ui/components/realtime-conversation";
import type { WorkspaceController } from "../../../src/ui/hooks/use-workspace";
import { renderComponent } from "./render.tsx";

const agent = vi.hoisted(() => ({
  pendingApprovals: vi.fn(async () => [])
}));
const chat = vi.hoisted(() => ({
  connectionError: null,
  error: null,
  isRecovering: false,
  isStreaming: false,
  messages: [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "hey how are you?" }] },
    { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "I'm doing well." }] }
  ] as Array<{ id: string; role: "user" | "assistant"; parts: unknown[] }>,
  sendMessage: vi.fn(),
  status: "ready",
  stop: vi.fn()
}));

vi.mock("agents/react", () => ({
  useAgent: () => ({ connectionError: null, stub: agent })
}));
vi.mock("@cloudflare/think/react", () => ({
  useAgentChat: () => chat
}));

const teammate = {
  id: "bot-1",
  name: "Teammate",
  title: "hey how are you?",
  description: "I will help with this job: hey how are you?",
  brief: "hey how are you?",
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
  vi.clearAllMocks();
  chat.messages = [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "hey how are you?" }] },
    { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "I'm doing well." }] }
  ];
});

describe("RealtimeConversation", () => {
  it("shows the real transcript without a synthetic profile message", async () => {
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] }
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <RealtimeConversation
        bot={teammate}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={() => undefined}
      />
    );

    expect(view.container.textContent).toContain("hey how are you?");
    expect(view.container.textContent).toContain("I'm doing well.");
    expect(view.container.textContent).not.toContain("I will help with this job");
    expect(view.container.querySelector('[role="log"]')?.getAttribute("aria-label")).toBe(
      "Conversation with Teammate"
    );
    await view.unmount();
  });

  it("shows a neutral empty state without inventing an assistant message", async () => {
    chat.messages = [];
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] }
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <RealtimeConversation
        bot={teammate}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={() => undefined}
      />
    );

    expect(view.container.textContent).toContain("Start a conversation");
    expect(view.container.textContent).toContain("Send a message to Teammate below.");
    expect(view.container.textContent).not.toContain("I will help with this job");
    await view.unmount();
  });

  it("keeps the accepted first message visible while Think hydrates the transcript", async () => {
    chat.messages = [];
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      pendingInitialMessage: { botId: teammate.id, text: "hey how are you?" },
      sending: true,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] }
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <RealtimeConversation
        bot={teammate}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={() => undefined}
      />
    );

    expect(view.container.textContent).toContain("hey how are you?");
    expect(view.container.textContent).not.toContain("Start a conversation");
    expect(
      view.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.disabled
    ).toBe(true);
    await view.unmount();
  });

  it("clears a preserved workspace error when the owner retries", async () => {
    const setError = vi.fn();
    const controller = {
      detailsOpen: true,
      error: "Think is unavailable",
      load: vi.fn(async () => undefined),
      sending: false,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setError,
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] }
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <RealtimeConversation
        bot={teammate}
        controller={controller}
        prompt="try again"
        showBack={false}
        onPromptChange={() => undefined}
      />
    );
    const form = view.container.querySelector("form");
    if (!form) throw new Error("The chat form did not render");

    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(setError).toHaveBeenCalledWith("");
    expect(chat.sendMessage).toHaveBeenCalledWith({ text: "try again", files: undefined });
    await view.unmount();
  });
});
