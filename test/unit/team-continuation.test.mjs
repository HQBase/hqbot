// Exercise the Worker class with an isolated host; Node and Worker globals stay in separate projects.
import { expect, it, vi } from "vitest";
import { TeammateCoordinationRuntime } from "../../src/teammate-coordination";

vi.mock("../../src/teammate-product", () => ({
  activeDeliveryKey: "delivery",
  TeammateProductRuntime: class {
    async productContinuation() {}
    async productResponse() {}
  }
}));

const message = (id, role, text) => ({
  id,
  role,
  parts: [{ type: "text", text }]
});
function fixture() {
  const storage = new Map([
    [
      "hqbot:active-team-work",
      {
        workId: "work",
        turnId: "turn",
        assignmentId: "assignment",
        specialist: true
      }
    ]
  ]);
  const messages = [
    message("team-work:turn", "user", "Assignment"),
    message("pending", "assistant", "Waiting for approval")
  ];
  const integration = { hasPendingContinuation: vi.fn(() => true), pending: vi.fn(async () => []) };
  const finish = vi.fn(async () => undefined);
  const host = Object.assign(Object.create(TeammateCoordinationRuntime.prototype), {
    name: "specialist",
    messages,
    activeTurnMetadata: { source: "team-work" },
    ctx: {
      storage: {
        get: async (key) => storage.get(key),
        put: async (key, value) => {
          storage.set(key, value);
        },
        delete: async (key) => storage.delete(key)
      }
    },
    tasks: { active: () => null },
    processes: { active: () => null },
    integrationRuntime: integration,
    pendingApprovals: async () => [],
    waitUntilStable: async () => true,
    inspectSubmission: vi.fn(async () => ({
      status: "completed",
      completedAt: Date.now() - 60000
    })),
    workspaceAgent: {
      finishTeamTurn: finish,
      teamWorkForBot: async () => ({
        state: "active",
        assignments: [{ id: "assignment", state: "returned" }]
      })
    }
  });
  return { host, integration, finish, storage };
}

it("does not publish the pre-approval reply during execution, submission, or continuation recovery", async () => {
  const { host, integration, finish } = fixture();
  expect((await host.teamWorkStatus("turn")).result).toBeNull();
  await host.productResponse({
    status: "completed",
    message: host.messages[1]
  });
  expect(finish).not.toHaveBeenCalled();
  await host.productContinuation("integration:run");
  host.messages.push(message("integration:run", "user", "Verified service result"));
  integration.hasPendingContinuation.mockReturnValue(false);
  host.inspectSubmission.mockResolvedValue({ status: "queued" });
  expect((await host.teamWorkStatus("turn")).result).toBeNull();
  expect(host.inspectSubmission).toHaveBeenLastCalledWith("integration:run");
  await host.productResponse({
    status: "completed",
    message: host.messages[1]
  });
  expect(finish).not.toHaveBeenCalled();
  host.messages.push(message("final", "assistant", "Checked source and confirmed action ID"));
  host.inspectSubmission.mockResolvedValue({
    status: "completed",
    completedAt: Date.now() - 60000
  });
  expect((await host.teamWorkStatus("turn")).result).toEqual({
    text: "Checked source and confirmed action ID",
    failed: false
  });
  expect(finish).toHaveBeenCalledExactlyOnceWith(
    "turn",
    "specialist",
    "Checked source and confirmed action ID",
    false
  );
});

it("keeps team context for the final integration response", async () => {
  const { host, integration, finish } = fixture();
  await host.productContinuation("integration:run");
  integration.hasPendingContinuation.mockReturnValue(false);
  host.activeTurnMetadata = {
    source: "integration-result",
    integrationResultId: "integration:run"
  };
  await host.productResponse({
    status: "completed",
    message: message("final", "assistant", "Verified evidence")
  });
  expect(finish).toHaveBeenCalledExactlyOnceWith("turn", "specialist", "Verified evidence", false);
});
