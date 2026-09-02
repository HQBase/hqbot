// @vitest-environment happy-dom

import type { PendingAction } from "@cloudflare/codemode";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BotFile, BotTeammate } from "../../../src/domain/types";
import { RealtimeConversation } from "../../../src/ui/components/realtime-conversation";
import type { WorkspaceController } from "../../../src/ui/hooks/use-workspace";
import * as initialMessageModule from "../../../src/ui/lib/initial-message";
import { interact, renderComponent } from "./render.tsx";

const submitInitialMessage = vi.hoisted(() =>
  vi.fn(async (): Promise<"pending" | "delivered"> => "delivered")
);
const uploadArtifacts = vi.hoisted(() => vi.fn(async (): Promise<BotFile[]> => []));
const agent = vi.hoisted(() => ({
  approveIntegrationAction: vi.fn(async () => undefined),
  listIntegrationApprovals: vi.fn<() => Promise<PendingAction[]>>(async () => []),
  rejectIntegrationAction: vi.fn(async () => true),
  ready: Promise.resolve(),
  submitChat: vi.fn(
    async (): Promise<
      | { accepted: true; submissionId: string }
      | {
          accepted: false;
          error?: string;
          messageApplied: boolean;
          status: string;
          submissionId: string;
        }
      | null
    > => ({ accepted: true, submissionId: "steer:1" })
  )
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
  ] as Array<{
    id: string;
    metadata?: unknown;
    role: "user" | "assistant";
    parts: unknown[];
  }>,
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
vi.mock("../../../src/ui/lib/artifact-upload", async (importOriginal) => ({
  ...(await importOriginal()),
  uploadArtifacts
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
  maxSteps: null,
  modelId: "@cf/zai-org/glm-5.3-flash",
  dailyBudgetUsd: 2,
  createdAt: "2026-08-30T12:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z"
} satisfies BotTeammate;

const uploadedFile = {
  botId: teammate.id,
  contentType: "image/png",
  createdAt: "2026-08-30T12:05:00.000Z",
  id: "file-1",
  key: "files/bot-1/file-1/source.png",
  name: "source.png",
  size: 4,
  taskId: null
} satisfies BotFile;
const uploadedReference = {
  botId: uploadedFile.botId,
  contentType: uploadedFile.contentType,
  createdAt: uploadedFile.createdAt,
  id: uploadedFile.id,
  name: uploadedFile.name,
  size: uploadedFile.size
};

function deferred<T>(): {
  promise: Promise<T>;
  reject: (cause: unknown) => void;
  resolve: (value: T) => void;
} {
  let reject!: (cause: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function ConversationHarness({
  controller,
  initialPrompt
}: {
  controller: WorkspaceController;
  initialPrompt: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  return (
    <RealtimeConversation
      bot={teammate}
      controller={controller}
      prompt={prompt}
      showBack={false}
      onPromptChange={setPrompt}
    />
  );
}

async function attachFile(container: HTMLElement, file: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("The file input did not render");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await interact(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}

async function setTextareaValue(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await interact(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

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
  submitInitialMessage.mockResolvedValue("delivered");
  uploadArtifacts.mockResolvedValue([]);
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

  it("hides internal task continuations and keeps the assistant response visible", async () => {
    chat.messages = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Research this topic" }] },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "I will continue in the background." }]
      },
      {
        id: "task-turn-2",
        role: "user",
        parts: [{ type: "text", text: "[hqbot:active-task] Continue the saved task." }],
        metadata: { turnMetadata: { source: "active-task" } }
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{ type: "text", text: "The background work is complete." }]
      }
    ];
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

    expect(view.container.textContent).toContain("Research this topic");
    expect(view.container.textContent).not.toContain("[hqbot:active-task]");
    expect(view.container.textContent).toContain("The background work is complete.");
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
    expect(view.container.querySelector('button[aria-label="Stop"]')).not.toBeNull();
    expect(view.container.querySelector('button[aria-label="Send"]')).toBeNull();
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
      new initialMessageModule.InitialMessageAdmissionUnknownError(
        new TypeError("The response was lost")
      )
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

  it("polls an uncertain first message until its terminal result", async () => {
    chat.messages = [];
    submitInitialMessage
      .mockRejectedValueOnce(
        new initialMessageModule.InitialMessageAdmissionUnknownError(
          new TypeError("The response was lost")
        )
      )
      .mockResolvedValueOnce("pending")
      .mockRejectedValueOnce(new Error("The message stopped before it started"));
    let retry: (() => void) | undefined;
    const timer = vi
      .spyOn(initialMessageModule, "scheduleInitialMessageRetry")
      .mockImplementation((_attempt, callback) => {
        retry = callback;
        return 1;
      });
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

    if (!retry) throw new Error("The retry was not scheduled");
    retry();
    await interact();

    expect(submitInitialMessage).toHaveBeenCalledTimes(2);
    if (!retry) throw new Error("The pending message was not checked again");
    retry();
    await interact();

    expect(submitInitialMessage).toHaveBeenCalledTimes(3);
    expect(submitInitialMessage).toHaveBeenNthCalledWith(1, teammate.id, "hey how are you?");
    expect(submitInitialMessage).toHaveBeenNthCalledWith(2, teammate.id, "hey how are you?");
    expect(submitInitialMessage).toHaveBeenNthCalledWith(3, teammate.id, "hey how are you?");
    expect(takePendingInitialMessage).toHaveBeenCalledWith(teammate.id);
    expect(onPromptChange).toHaveBeenCalledWith("hey how are you?");
    timer.mockRestore();
    await view.unmount();
  });

  it("hides stream protocol parts and keeps one thinking response during reasoning", async () => {
    chat.messages = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "step-start" }, { type: "reasoning", text: "", state: "streaming" }]
      }
    ];
    chat.status = "streaming";
    chat.isStreaming = true;
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] }
    } as unknown as WorkspaceController;
    const content = () => (
      <RealtimeConversation
        bot={teammate}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={() => undefined}
      />
    );
    const view = await renderComponent(content());
    const log = view.container.querySelector('[role="log"]');

    expect(log?.textContent).not.toContain("step start");
    expect(log?.textContent?.match(/Teammate/gu)).toHaveLength(1);
    expect(log?.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(log?.querySelector('[role="status"]')?.textContent).toContain("Thinking");

    chat.messages = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "reasoning", text: "I should check", state: "streaming" }
        ]
      }
    ];
    await view.rerender(content());

    expect(view.container.textContent).toContain("Thought process");
    expect(view.container.textContent).toContain("I should check");
    expect(view.container.textContent).not.toContain("step start");
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Thinking");
    await view.unmount();
  });

  it("does not force the conversation to the bottom after the owner scrolls up", async () => {
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] }
    } as unknown as WorkspaceController;
    const content = () => (
      <RealtimeConversation
        bot={teammate}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={() => undefined}
      />
    );
    const view = await renderComponent(content());
    const conversation = view.container.querySelector<HTMLElement>(".hqbot-conversation-surface");
    if (!conversation) throw new Error("The conversation did not render");
    Object.defineProperties(conversation, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 }
    });
    conversation.scrollTop = 100;
    conversation.dispatchEvent(new Event("scroll", { bubbles: true }));

    chat.messages = [
      ...chat.messages,
      { id: "assistant-2", role: "assistant", parts: [{ type: "text", text: "More text" }] }
    ];
    await view.rerender(content());

    expect(conversation.scrollTop).toBe(100);
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

  it("shows thinking when a streamed reply pauses before its next tool call", async () => {
    chat.messages = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Create a PDF" }] },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Let me write the summary document." }]
      }
    ];
    chat.status = "streaming";
    chat.isStreaming = true;
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

    expect(view.container.querySelector('[role="status"]')).toBeNull();
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    await interact();
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Thinking");
    await view.unmount();
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

  it("shows the durable Bash and resume phases", async () => {
    const workingTeammate = { ...teammate, status: "working" as const };
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      selectedTask: { wakeAt: null, workState: "waiting" },
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [workingTeammate] }
    } as unknown as WorkspaceController;
    const content = () => (
      <RealtimeConversation
        bot={workingTeammate}
        controller={controller}
        prompt=""
        showBack={false}
        onPromptChange={() => undefined}
      />
    );
    const view = await renderComponent(content());

    expect(view.container.querySelector('[role="status"]')?.textContent).toContain(
      "Bash is running"
    );

    controller.selectedTask = { wakeAt: null, workState: "running" } as never;
    await view.rerender(content());

    expect(view.container.querySelector('[role="status"]')?.textContent).toContain(
      "Bash finished — resuming agent"
    );
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
    expect(chat.sendMessage).toHaveBeenCalledWith(
      { parts: [{ type: "text", text: "try again" }] },
      { body: { artifactIds: [] } }
    );
    await view.unmount();
  });

  it("clears the prompt and attachment chips before a durable send resolves", async () => {
    const pendingSend = deferred<undefined>();
    chat.sendMessage.mockImplementationOnce(() => pendingSend.promise);
    uploadArtifacts.mockResolvedValueOnce([uploadedFile]);
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      sending: false,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setError: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] }
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <ConversationHarness controller={controller} initialPrompt="split this" />
    );
    const source = new File(["test"], uploadedFile.name, { type: uploadedFile.contentType });
    await attachFile(view.container, source);
    expect(view.container.textContent).toContain(uploadedFile.name);

    await interact(() =>
      view.container
        .querySelector("form")
        ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
    );

    expect(uploadArtifacts).toHaveBeenCalledWith(teammate.id, [source]);
    expect(chat.sendMessage).toHaveBeenCalledWith(
      {
        parts: [
          { type: "text", text: "split this" },
          { type: "data-artifacts", data: [uploadedReference] }
        ]
      },
      { body: { artifactIds: [uploadedFile.id] } }
    );
    expect(view.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(
      view.container.querySelector(`button[aria-label="Remove ${uploadedFile.name}"]`)
    ).toBeNull();

    pendingSend.resolve(undefined);
    await interact();
    await view.unmount();
  });

  it("does not replace a newer draft when a durable send fails", async () => {
    const pendingSend = deferred<undefined>();
    chat.sendMessage.mockImplementationOnce(() => pendingSend.promise);
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      sending: false,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setError: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] }
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <ConversationHarness controller={controller} initialPrompt="first draft" />
    );

    await interact(() =>
      view.container
        .querySelector("form")
        ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
    );
    const textarea = view.container.querySelector<HTMLTextAreaElement>("textarea");
    if (!textarea) throw new Error("The composer textarea did not render");
    expect(textarea.value).toBe("");
    await setTextareaValue(textarea, "newer draft");

    pendingSend.reject(new Error("The durable send failed"));
    await interact();

    expect(textarea.value).toBe("newer draft");
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      "The durable send failed"
    );
    await view.unmount();
  });

  it("stops the active turn before it durably submits a steering message", async () => {
    chat.isStreaming = true;
    chat.status = "streaming";
    const stopSelectedBot = vi.fn(async () => undefined);
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      sending: false,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setError: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] },
      stopSelectedBot
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <ConversationHarness controller={controller} initialPrompt="Use the other page" />
    );

    await interact(() =>
      view.container
        .querySelector("form")
        ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
    );

    expect(chat.stop).toHaveBeenCalledOnce();
    expect(agent.submitChat).toHaveBeenCalledOnce();
    expect(chat.stop.mock.invocationCallOrder[0]).toBeLessThan(
      agent.submitChat.mock.invocationCallOrder[0] ?? 0
    );
    expect(stopSelectedBot).not.toHaveBeenCalled();
    expect(agent.submitChat).toHaveBeenCalledWith({
      prompt: "Use the other page",
      submissionId: expect.stringMatching(/^steer:/u)
    });
    expect(chat.sendMessage).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("restores a steering message when its durable submission is rejected", async () => {
    chat.isStreaming = true;
    chat.status = "streaming";
    agent.submitChat.mockResolvedValueOnce({
      accepted: false,
      error: "The earlier turn is still stopping",
      messageApplied: false,
      status: "failed",
      submissionId: "steer:failed"
    });
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      sending: false,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setError: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] }
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <ConversationHarness controller={controller} initialPrompt="Try this after the stop" />
    );

    await interact(() =>
      view.container
        .querySelector("form")
        ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
    );

    expect(view.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Try this after the stop"
    );
    expect(view.container.textContent).toContain("The earlier turn is still stopping");
    await view.unmount();
  });

  it("stops the active turn and durable work from the composer", async () => {
    chat.isStreaming = true;
    chat.status = "streaming";
    const stopSelectedBot = vi.fn(async () => undefined);
    const controller = {
      detailsOpen: true,
      error: "",
      load: vi.fn(async () => undefined),
      sending: false,
      setDetailsOpen: vi.fn(),
      setDialog: vi.fn(),
      setError: vi.fn(),
      setMobileChatOpen: vi.fn(),
      snapshot: { bots: [teammate] },
      stopSelectedBot
    } as unknown as WorkspaceController;
    const view = await renderComponent(
      <ConversationHarness controller={controller} initialPrompt="" />
    );

    await interact(() =>
      view.container.querySelector<HTMLButtonElement>('button[aria-label="Stop"]')?.click()
    );

    expect(chat.stop).toHaveBeenCalledOnce();
    expect(stopSelectedBot).toHaveBeenCalledOnce();
    await view.unmount();
  });
});
