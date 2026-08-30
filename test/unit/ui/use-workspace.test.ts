// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEEPSEEK_FALLBACK_MODEL_ID, GLM_PRIMARY_MODEL_ID } from "../../../src/domain/models";
import {
  createTeammate,
  useWorkspace,
  type WorkspaceController
} from "../../../src/ui/hooks/use-workspace";
import {
  InitialMessageAdmissionUnknownError,
  submitInitialMessage
} from "../../../src/ui/lib/initial-message";
import { interact, renderComponent } from "./render.tsx";

vi.mock("../../../src/ui/hooks/use-workspace-events", () => ({
  useWorkspaceEvents: () => "live"
}));

let currentController: WorkspaceController | null = null;

function WorkspaceHarness() {
  const controller = useWorkspace(() => undefined);
  currentController = controller;
  return createElement("p", null, controller.error);
}

function controller(): WorkspaceController {
  if (!currentController) throw new Error("The workspace controller did not render");
  return currentController;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}

afterEach(() => {
  currentController = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("new teammate chat", () => {
  it("starts with both mobile sidebars collapsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ archivedBots: [], bots: [], realtime: { url: null } }))
    );
    const view = await renderComponent(createElement(WorkspaceHarness));

    expect(controller().mobileChatOpen).toBe(true);
    expect(controller().detailsOpen).toBe(false);
    await view.unmount();
  });

  it("uses the first message for the teammate and its first chat turn", async () => {
    const teammate = { id: "bot-1", name: "Teammate" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ teammate }, 201))
      .mockResolvedValueOnce(jsonResponse({ accepted: true, submissionId: "first:bot-1" }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createTeammate("hey how are you?")).resolves.toEqual(teammate);
    await expect(submitInitialMessage("bot-1", "hey how are you?")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/bots",
      expect.objectContaining({
        body: JSON.stringify({ brief: "hey how are you?", conversation: true }),
        credentials: "include",
        method: "POST"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/bots/bot-1/messages/initial",
      expect.objectContaining({
        body: JSON.stringify({ prompt: "hey how are you?" }),
        credentials: "include",
        method: "POST"
      })
    );
  });

  it("exposes the first message before teammate creation finishes", async () => {
    const teammate = { id: "bot-optimistic", name: "Teammate" };
    const emptySnapshot = { archivedBots: [], bots: [], realtime: { url: null }, tasks: [] };
    const created = Promise.withResolvers<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockReturnValueOnce(created.promise)
      .mockResolvedValueOnce(
        jsonResponse({ ...emptySnapshot, bots: [teammate], selectedBot: teammate })
      );
    vi.stubGlobal("fetch", fetchMock);
    const view = await renderComponent(createElement(WorkspaceHarness));

    let result: Promise<boolean> | undefined;
    await interact(() => {
      result = controller().send("hey how are you?");
    });
    expect(controller().sending).toBe(true);
    expect(controller().pendingInitialMessage).toEqual({
      botId: null,
      text: "hey how are you?"
    });

    created.resolve(jsonResponse({ teammate }, 201));
    await expect(result).resolves.toBe(true);
    await interact();
    expect(controller().pendingInitialMessage).toEqual({
      botId: teammate.id,
      text: "hey how are you?"
    });
    await view.unmount();
  });

  it("keeps the full message outside the profile and retries a lost response", async () => {
    const message = "a".repeat(2_500);
    const teammate = { id: "bot-2", name: "Teammate" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ teammate }, 201))
      .mockRejectedValueOnce(new TypeError("The network connection was lost"))
      .mockResolvedValueOnce(jsonResponse({ accepted: false, submissionId: "first:bot-2" }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createTeammate(message)).resolves.toEqual(teammate);
    await expect(submitInitialMessage("bot-2", message)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/bots",
      expect.objectContaining({
        body: JSON.stringify({ brief: message.slice(0, 2_000), conversation: true })
      })
    );
    for (const call of [2, 3]) {
      expect(fetchMock).toHaveBeenNthCalledWith(
        call,
        "/api/bots/bot-2/messages/initial",
        expect.objectContaining({ body: JSON.stringify({ prompt: message }) })
      );
    }
  });

  it("keeps delivery uncertain after both idempotent responses are lost", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("The first response was lost"))
      .mockRejectedValueOnce(new TypeError("The retry response was lost"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitInitialMessage("bot-2", "hey")).rejects.toBeInstanceOf(
      InitialMessageAdmissionUnknownError
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("selects the new teammate before the live chat sends the first message", async () => {
    const teammate = { id: "bot-3", name: "Teammate" };
    const emptySnapshot = { archivedBots: [], bots: [], realtime: { url: null }, tasks: [] };
    const teammateSnapshot = {
      ...emptySnapshot,
      bots: [teammate],
      selectedBot: teammate
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockResolvedValueOnce(jsonResponse({ teammate }, 201))
      .mockResolvedValueOnce(jsonResponse(teammateSnapshot));
    vi.stubGlobal("fetch", fetchMock);
    const view = await renderComponent(createElement(WorkspaceHarness));

    await expect(controller().send("hey how are you?")).resolves.toBe(true);
    await interact();
    expect(controller().selectedBot?.id).toBe("bot-3");
    expect(controller().pendingInitialMessage).toEqual({
      botId: "bot-3",
      text: "hey how are you?"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/messages/initial"))).toBe(
      false
    );
    await view.unmount();
  });
});

describe("teammate model", () => {
  it("saves and reloads the selected model", async () => {
    const bot = {
      id: "bot-1",
      name: "Teammate",
      modelId: GLM_PRIMARY_MODEL_ID
    };
    const snapshot = {
      archivedBots: [],
      bots: [bot],
      realtime: { url: null },
      selectedBot: bot,
      tasks: []
    };
    const updatedBot = { ...bot, modelId: DEEPSEEK_FALLBACK_MODEL_ID };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(snapshot))
      .mockResolvedValueOnce(jsonResponse({ teammate: updatedBot }))
      .mockResolvedValueOnce(
        jsonResponse({ ...snapshot, bots: [updatedBot], selectedBot: updatedBot })
      );
    vi.stubGlobal("fetch", fetchMock);
    const view = await renderComponent(createElement(WorkspaceHarness));

    await controller().setModel(DEEPSEEK_FALLBACK_MODEL_ID);
    await interact();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/bots/bot-1",
      expect.objectContaining({
        body: JSON.stringify({ modelId: DEEPSEEK_FALLBACK_MODEL_ID }),
        method: "PATCH"
      })
    );
    expect(controller().selectedBot?.modelId).toBe(DEEPSEEK_FALLBACK_MODEL_ID);
    await view.unmount();
  });

  it("stops all current activity for the selected teammate", async () => {
    const bot = { id: "bot-1", name: "Teammate", modelId: GLM_PRIMARY_MODEL_ID };
    const snapshot = {
      archivedBots: [],
      bots: [bot],
      realtime: { url: null },
      selectedBot: bot,
      tasks: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(snapshot))
      .mockResolvedValueOnce(jsonResponse({ stopped: true }))
      .mockResolvedValueOnce(jsonResponse(snapshot));
    vi.stubGlobal("fetch", fetchMock);
    const view = await renderComponent(createElement(WorkspaceHarness));

    await controller().stopSelectedBot();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/bots/bot-1/stop",
      expect.objectContaining({ method: "POST" })
    );
    await view.unmount();
  });

  it("clears an optimistic first message after its teammate stops", async () => {
    const bot = { id: "bot-stop", name: "Teammate", modelId: GLM_PRIMARY_MODEL_ID };
    const empty = { archivedBots: [], bots: [], realtime: { url: null }, tasks: [] };
    const selected = { ...empty, bots: [bot], selectedBot: bot };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(empty))
      .mockResolvedValueOnce(jsonResponse({ teammate: bot }, 201))
      .mockResolvedValueOnce(jsonResponse(selected))
      .mockResolvedValueOnce(jsonResponse({ stopped: true }))
      .mockResolvedValueOnce(jsonResponse(selected));
    vi.stubGlobal("fetch", fetchMock);
    const view = await renderComponent(createElement(WorkspaceHarness));

    await controller().send("hey");
    await interact();
    expect(controller().pendingInitialMessage).toEqual({ botId: bot.id, text: "hey" });

    await controller().stopSelectedBot();
    await interact();

    expect(controller().pendingInitialMessage).toBeNull();
    await view.unmount();
  });

  it("deletes the selected teammate and selects the next recent teammate", async () => {
    const first = { id: "bot-1", name: "First", modelId: GLM_PRIMARY_MODEL_ID };
    const next = { id: "bot-2", name: "Next", modelId: GLM_PRIMARY_MODEL_ID };
    const initial = {
      archivedBots: [],
      bots: [first, next],
      realtime: { url: null },
      selectedBot: first,
      tasks: []
    };
    const remaining = { ...initial, bots: [next], selectedBot: next };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }))
      .mockResolvedValueOnce(jsonResponse(remaining));
    vi.stubGlobal("fetch", fetchMock);
    const view = await renderComponent(createElement(WorkspaceHarness));

    await controller().deleteSelectedBot();
    await interact();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/bots/bot-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(controller().selectedBot?.id).toBe("bot-2");
    await view.unmount();
  });
});
