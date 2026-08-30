// @vitest-environment happy-dom

import type { PendingAction } from "@cloudflare/codemode";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BotTeammate } from "../../../src/domain/types";
import { RealtimeConversation } from "../../../src/ui/components/realtime-conversation";
import type { WorkspaceController } from "../../../src/ui/hooks/use-workspace";
import { InitialMessageAdmissionUnknownError } from "../../../src/ui/lib/initial-message";
import { interact, renderComponent } from "./render.tsx";

const submitInitialMessage = vi.hoisted(() => vi.fn(async () => undefined));
const agent = vi.hoisted(() => ({
  approveIntegrationAction: vi.fn(async () => undefined),
  listIntegrationApprovals: vi.fn<() => Promise<PendingAction[]>>(async () => []),
  rejectIntegrationAction: vi.fn(async () => true),
  ready: Promise.resolve()
}));
const chat = vi.hoisted(() => ({
  connectionError: null,
  error: null,
  isRecovering: false,
  isStreaming: false,
  isToolContinuation: false,
  messages: [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "hey how are you?" }] },
    { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "I'm doing well." }] }
  ] as Array<{ id: string; role: "user" | "assistant"; parts: unknown[] }>,
  sendMessage: vi.fn(async () => undefined),
  status: "ready",
  stop: vi.fn()
}));

vi.mock("agents/react", () => ({
  useAgent: () => ({ connectionError: null, ready: agent.ready, stub: agent })
}));
vi.mock("@cloudflare/think/react", () => ({
  useAgentChat: () => chat
}));
vi.mock("../../../src/ui/lib/initial-message", async (importOriginal) => ({
  ...(await importOriginal()),
  submitInitialMessage
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
  updatedAt: "2026-08-30T12:00:00.000Z"
} satisfies BotTeammate;

afterEach(() => {
  vi.clearAllMocks();
  agent.listIntegrationApprovals.mockResolvedValue([]);
  chat.messages = [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "hey how are you?" }] },
    { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "I'm doing well." }] }
  ];
  chat.isRecovering = false;
  chat.isStreaming = false;
  chat.isToolContinuation = false;
  chat.status = "ready";
  submitInitialMessage.mockResolvedValue(undefined);
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
      takePendingInitialMessage: vi.fn(() => null),
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

  it("durably submits a new teammate message once after the live agent is ready", async () => {
    chat.messages = [];
    const takePendingInitialMessage = vi.fn(() => "hey how are you?");
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      pendingInitialMessage: { botId: teammate.id, text: "hey how are you?" },
      sending: false,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] },
      takePendingInitialMessage
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <StrictMode>
        <RealtimeConversation
          bot={teammate}
          controller={controller}
          prompt=""
          showBack={false}
          onPromptChange={() => undefined}
        />
      </StrictMode>
    );

    expect(submitInitialMessage).toHaveBeenCalledTimes(1);
    expect(submitInitialMessage).toHaveBeenCalledWith(teammate.id, "hey how are you?");
    expect(takePendingInitialMessage).not.toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("restores the first message when durable submission fails", async () => {
    chat.messages = [];
    submitInitialMessage.mockRejectedValueOnce(new Error("The connection was lost"));
    const takePendingInitialMessage = vi.fn(() => "hey how are you?");
    const onPromptChange = vi.fn();
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      pendingInitialMessage: { botId: teammate.id, text: "hey how are you?" },
      sending: false,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] },
      takePendingInitialMessage
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <RealtimeConversation
        bot={teammate}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={onPromptChange}
      />
    );

    expect(takePendingInitialMessage).toHaveBeenCalledWith(teammate.id);
    expect(onPromptChange).toHaveBeenCalledWith("hey how are you?");
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      "The connection was lost"
    );
    await view.unmount();
  });

  it("keeps an uncertain first message until its fixed-ID broadcast arrives", async () => {
    chat.messages = [];
    submitInitialMessage.mockRejectedValueOnce(
      new InitialMessageAdmissionUnknownError(new TypeError("The response was lost"))
    );
    const takePendingInitialMessage = vi.fn(() => "hey how are you?");
    const onPromptChange = vi.fn();
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      pendingInitialMessage: { botId: teammate.id, text: "hey how are you?" },
      sending: false,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] },
      takePendingInitialMessage
    } as unknown as WorkspaceController;
    const content = () => (
      <RealtimeConversation
        bot={teammate}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={onPromptChange}
      />
    );
    const view = await renderComponent(content());

    expect(takePendingInitialMessage).not.toHaveBeenCalled();
    expect(onPromptChange).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Waiting to confirm your message");

    chat.messages = [
      {
        id: `chat:first:${teammate.id}`,
        role: "user",
        parts: [{ type: "text", text: "hey how are you?" }]
      }
    ];
    await view.rerender(content());

    expect(takePendingInitialMessage).toHaveBeenCalledWith(teammate.id);
    expect(submitInitialMessage).toHaveBeenCalledTimes(1);
    expect(onPromptChange).not.toHaveBeenCalled();
    expect(
      view.container.querySelector('[role="log"]')?.textContent?.match(/hey how are you\?/gu)
    ).toHaveLength(1);
    expect(view.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(view.container.textContent).not.toContain("Waiting to confirm your message");
    await view.unmount();
  });

  it("automatically retries an uncertain first message with the same identity", async () => {
    chat.messages = [];
    submitInitialMessage
      .mockRejectedValueOnce(
        new InitialMessageAdmissionUnknownError(new TypeError("The response was lost"))
      )
      .mockResolvedValueOnce(undefined);
    let retry: (() => void) | null = null;
    const nativeSetTimeout = window.setTimeout.bind(window);
    const timer = vi.spyOn(window, "setTimeout").mockImplementation((handler, timeout, ...args) => {
      if (timeout === 1_000) {
        retry = () => {
          if (typeof handler === "function") handler(...args);
        };
        return 1;
      }
      return nativeSetTimeout(handler, timeout, ...args);
    });
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      pendingInitialMessage: { botId: teammate.id, text: "hey how are you?" },
      sending: false,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] },
      takePendingInitialMessage: vi.fn(() => null)
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

    expect(retry).not.toBeNull();
    retry?.();
    await interact();

    expect(submitInitialMessage).toHaveBeenCalledTimes(2);
    expect(submitInitialMessage).toHaveBeenNthCalledWith(1, teammate.id, "hey how are you?");
    expect(submitInitialMessage).toHaveBeenNthCalledWith(2, teammate.id, "hey how are you?");
    timer.mockRestore();
    await view.unmount();
  });

  it("shows thinking before output and removes it for partial streamed text", async () => {
    chat.messages = [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] }];
    chat.status = "submitted";
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] }
    } as unknown as WorkspaceController;
    const waiting = await renderComponent(
      <RealtimeConversation
        bot={teammate}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={() => undefined}
      />
    );

    expect(waiting.container.querySelector('[role="status"]')?.textContent).toContain("Thinking");
    await waiting.unmount();

    chat.messages = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] },
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "I am" }] }
    ];
    chat.status = "streaming";
    chat.isStreaming = true;
    const streaming = await renderComponent(
      <RealtimeConversation
        bot={teammate}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={() => undefined}
      />
    );

    expect(streaming.container.textContent).toContain("I am");
    expect(
      [...streaming.container.querySelectorAll('[role="status"]')].some((node) =>
        node.textContent?.includes("Thinking")
      )
    ).toBe(false);
    await streaming.unmount();
  });

  it("labels a durable stream recovery", async () => {
    chat.messages = [];
    chat.isRecovering = true;
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

    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Recovering");
    await view.unmount();
  });

  it("stops the visible stream and all durable teammate activity", async () => {
    chat.isStreaming = true;
    chat.status = "streaming";
    const stopSelectedBot = vi.fn(async () => undefined);
    const controller = {
      detailsOpen: false,
      error: "",
      load: vi.fn(async () => undefined),
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] },
      stopSelectedBot
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

    await interact(() =>
      view.container
        .querySelector<HTMLButtonElement>('button[aria-label="Stop teammate activity"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );

    expect(chat.stop).toHaveBeenCalledTimes(1);
    expect(stopSelectedBot).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("offers stop for background teammate activity when the chat is idle", async () => {
    const controller = {
      detailsOpen: false,
      error: "",
      load: vi.fn(async () => undefined),
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] },
      stopSelectedBot: vi.fn(async () => undefined)
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <RealtimeConversation
        bot={{ ...teammate, status: "working" }}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={() => undefined}
      />
    );

    expect(
      view.container.querySelector('button[aria-label="Stop teammate activity"]')
    ).not.toBeNull();
    expect(view.container.textContent).toContain("Working");
    await view.unmount();
  });

  it("shows and resolves a connected-service approval", async () => {
    agent.listIntegrationApprovals.mockResolvedValue([
      {
        args: { title: "Open an issue" },
        connector: "mcp_github",
        executionId: "execution-1",
        method: "create_issue",
        seq: 1
      }
    ]);
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

    expect(view.container.textContent).toContain("Connected-service approval");
    expect(view.container.textContent).toContain("Open an issue");
    await interact(() =>
      [...view.container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Approve"))
        ?.click()
    );
    expect(agent.approveIntegrationAction).toHaveBeenCalledWith("execution-1");
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
