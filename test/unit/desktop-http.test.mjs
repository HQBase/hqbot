import { getAgentByName } from "agents";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleDesktop } from "../../src/http/desktop";
import { connectLinuxDesktop, teammateSandbox } from "../../src/runtime/desktop";

vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
vi.mock("../../src/runtime/desktop", () => ({
  connectLinuxDesktop: vi.fn(),
  teammateSandbox: vi.fn()
}));

const status = {
  checkpointAt: null,
  ownerControl: false,
  resources: null,
  running: false
};

function harness() {
  const workspaceBinding = {};
  const teammateBinding = {};
  const workspace = {
    checkSpendPolicy: vi.fn().mockResolvedValue({ allowed: true, reason: null }),
    getBot: vi.fn().mockResolvedValue({ hidden: false, id: "bot-1" })
  };
  const peer = {
    getComputerStatus: vi.fn().mockResolvedValue(status),
    openComputer: vi.fn(),
    renewComputerControl: vi.fn().mockResolvedValue(null),
    setComputerControl: vi.fn().mockResolvedValue(status),
    setComputerMode: vi.fn(),
    stopComputer: vi.fn()
  };
  const env = {
    HQBOT_AGENT: workspaceBinding,
    HQBOT_ID: "hqbot",
    HQBOT_TEAMMATE: teammateBinding,
    SANDBOX: {}
  };
  vi.mocked(getAgentByName).mockImplementation(async (binding) =>
    binding === workspaceBinding ? workspace : peer
  );
  return { env, peer, workspace };
}

function request(path, init) {
  return new Request(`https://hqbot.example${path}`, init);
}

function jsonRequest(method, body) {
  return request("/api/bots/bot-1/desktop", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method
  });
}

function socketRequest(origin = "https://hqbot.example") {
  return request("/api/bots/bot-1/desktop/ws", {
    headers: { Origin: origin, Upgrade: "websocket" }
  });
}

describe("computer HTTP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the teammate computer status", async () => {
    const { env, peer } = harness();

    const response = await handleDesktop(request("/api/bots/bot-1/desktop"), env);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual(status);
    expect(peer.getComputerStatus).toHaveBeenCalledOnce();
  });

  it("renews only control that the teammate already granted", async () => {
    const { env, peer, workspace } = harness();
    const granted = { ...status, ownerControl: true, running: true };
    peer.renewComputerControl.mockResolvedValueOnce(granted);

    const response = await handleDesktop(jsonRequest("PATCH", { ownerControl: true }), env);

    expect(response?.status).toBe(200);
    expect(workspace.checkSpendPolicy).toHaveBeenCalledWith("bot-1", null);
    expect(peer.renewComputerControl).toHaveBeenCalledOnce();
    expect(peer.setComputerControl).not.toHaveBeenCalled();
    await expect(response?.json()).resolves.toEqual(granted);
  });

  it("does not let the owner create a control grant", async () => {
    const { env, peer, workspace } = harness();
    const response = await handleDesktop(jsonRequest("PATCH", { ownerControl: true }), env);

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: "Ask the teammate to give you control"
    });
    expect(workspace.checkSpendPolicy).toHaveBeenCalledWith("bot-1", null);
    expect(peer.renewComputerControl).toHaveBeenCalledOnce();
    expect(peer.setComputerControl).not.toHaveBeenCalled();
  });

  it("lets the owner release granted control", async () => {
    const { env, peer, workspace } = harness();

    const response = await handleDesktop(jsonRequest("PATCH", { ownerControl: false }), env);

    expect(response?.status).toBe(200);
    expect(peer.setComputerControl).toHaveBeenCalledWith(false);
    expect(peer.getComputerStatus).not.toHaveBeenCalled();
    expect(workspace.checkSpendPolicy).not.toHaveBeenCalled();
  });

  it("rejects an invalid control payload", async () => {
    const { env, peer } = harness();

    const response = await handleDesktop(jsonRequest("PATCH", { ownerControl: "yes" }), env);

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({ error: "ownerControl is required" });
    expect(peer.setComputerControl).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", { requestId: "open-1" }],
    ["DELETE", undefined]
  ])("does not expose %s lifecycle control", async (method, body) => {
    const { env, peer } = harness();
    const input =
      body === undefined
        ? request("/api/bots/bot-1/desktop", { method })
        : jsonRequest(method, body);

    const response = await handleDesktop(input, env);

    expect(response?.status).toBe(405);
    expect(response?.headers.get("Allow")).toBe("GET, PATCH");
    expect(peer.openComputer).not.toHaveBeenCalled();
    expect(peer.stopComputer).not.toHaveBeenCalled();
    expect(peer.setComputerMode).not.toHaveBeenCalled();
  });

  it("does not expose computer mode control", async () => {
    const { env, peer } = harness();

    const response = await handleDesktop(jsonRequest("PATCH", { mode: "economy" }), env);

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({ error: "ownerControl is required" });
    expect(peer.setComputerMode).not.toHaveBeenCalled();
  });

  it("rejects a desktop WebSocket that is not same-origin", async () => {
    const { env, peer } = harness();

    const response = await handleDesktop(socketRequest("https://evil.example"), env);

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: "A same-origin WebSocket is required"
    });
    expect(peer.getComputerStatus).not.toHaveBeenCalled();
    expect(teammateSandbox).not.toHaveBeenCalled();
    expect(connectLinuxDesktop).not.toHaveBeenCalled();
  });

  it("does not start an off computer for a desktop WebSocket", async () => {
    const { env, peer, workspace } = harness();

    const response = await handleDesktop(socketRequest(), env);

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({ error: "The computer is not running" });
    expect(peer.openComputer).not.toHaveBeenCalled();
    expect(workspace.checkSpendPolicy).not.toHaveBeenCalled();
    expect(teammateSandbox).not.toHaveBeenCalled();
    expect(connectLinuxDesktop).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true
  ])("connects a running desktop with ownerControl=%s without starting it", async (ownerControl) => {
    const { env, peer, workspace } = harness();
    const sandbox = {};
    const request = socketRequest();
    peer.getComputerStatus.mockResolvedValueOnce({ ...status, ownerControl, running: true });
    vi.mocked(teammateSandbox).mockReturnValueOnce(sandbox);
    vi.mocked(connectLinuxDesktop).mockResolvedValueOnce(new Response("connected"));

    const response = await handleDesktop(request, env);

    expect(await response?.text()).toBe("connected");
    expect(workspace.checkSpendPolicy).toHaveBeenCalledWith("bot-1", null);
    expect(peer.openComputer).not.toHaveBeenCalled();
    expect(teammateSandbox).toHaveBeenCalledWith(env, "bot-1");
    expect(connectLinuxDesktop).toHaveBeenCalledWith(sandbox, "bot-1", request);
  });
});
