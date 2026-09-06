import { getAgentByName } from "agents";
import { beforeEach, expect, it, vi } from "vitest";
import { handleAttention } from "../../src/http/attention";

vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
const pending = {
  computerApprovals: [
    {
      executionId: "approval",
      inputHash: "hash",
      action: "browser_open",
      input: { url: "https://example.com" }
    }
  ],
  integrationApprovals: [],
  handoff: null
};
function fixture() {
  const agent = {
    getBot: vi.fn(async (id) => ({ id, name: id, hidden: false })),
    teamWorkForBot: vi.fn(async () => ({
      state: "waiting",
      assignments: [
        { botId: "child", state: "submitted" },
        { botId: "done", state: "returned" }
      ]
    }))
  };
  const peer = {
    getOwnerAttention: vi.fn(async () => pending),
    resolveComputerApproval: vi.fn(async () => ({ ok: true })),
    completeOwnerHandoff: vi.fn(async () => ({ resumed: true })),
    reconnectOwnerHandoff: vi.fn(async () => ({ ownerControl: true })),
    listIntegrationApprovals: vi.fn(async () => []),
    approveIntegrationAction: vi.fn()
  };
  const env = { HQBOT_AGENT: {}, HQBOT_TEAMMATE: {}, HQBOT_ID: "hqbot" };
  vi.mocked(getAgentByName).mockImplementation(async (binding) =>
    binding === env.HQBOT_AGENT ? agent : peer
  );
  const request = (body) =>
    new Request(
      "https://hqbot.example/api/bots/chief/attention",
      body ? { method: "POST", body: JSON.stringify(body) } : {}
    );
  return { agent, peer, env, request };
}
beforeEach(() => vi.clearAllMocks());
it("surfaces owner and active descendant requests, excluding returned assignments", async () => {
  const { env, request } = fixture();
  const result = await (await handleAttention(request(), env)).json();
  expect(result.items.map((item) => item.botId)).toEqual(["chief", "child"]);
  expect(result.items[1].computerApprovals[0].input.url).toBe("https://example.com");
});
it("routes the exact child decision without changing permission policy", async () => {
  const { env, request, peer } = fixture();
  const response = await handleAttention(
    request({
      botId: "child",
      kind: "computer",
      id: "approval",
      inputHash: "hash",
      approved: true
    }),
    env
  );
  expect(response.status).toBe(200);
  expect(peer.resolveComputerApproval).toHaveBeenCalledWith("approval", "hash", true);
});
it("rejects a child decision after the root stops", async () => {
  const { env, request, peer, agent } = fixture();
  agent.teamWorkForBot.mockResolvedValue({
    state: "stopped",
    assignments: [{ botId: "child", state: "submitted" }]
  });
  expect(
    (await handleAttention(request({ botId: "child", kind: "continue", id: "handoff" }), env))
      .status
  ).toBe(409);
  expect(peer.completeOwnerHandoff).not.toHaveBeenCalled();
});
it("rejects unrelated peers and a stale MCP input hash", async () => {
  const { env, request, peer } = fixture();
  expect(
    (
      await handleAttention(
        request({
          botId: "other",
          kind: "computer",
          id: "approval",
          inputHash: "hash",
          approved: true
        }),
        env
      )
    ).status
  ).toBe(409);
  expect(
    (
      await handleAttention(
        request({
          botId: "child",
          kind: "integration",
          id: "approval",
          inputHash: "hash",
          seq: 0,
          approved: true
        }),
        env
      )
    ).status
  ).toBe(409);
  expect(peer.approveIntegrationAction).not.toHaveBeenCalled();
});
it("shows a per-agent load failure without losing another request", async () => {
  const { env, request, peer } = fixture();
  peer.getOwnerAttention.mockRejectedValueOnce(new Error("offline"));
  const { items } = await (await handleAttention(request(), env)).json();
  expect(items[0].error).toBeTruthy();
  expect(items[1].computerApprovals).toHaveLength(1);
});
