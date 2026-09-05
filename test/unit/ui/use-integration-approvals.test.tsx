// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationApproval } from "../../../src/domain/actions";
import { useIntegrationApprovals } from "../../../src/ui/hooks/use-integration-approvals";
import { interact, renderComponent } from "./render";

const approval = {
  executionId: "docs-test",
  seq: 1,
  connector: "docs",
  method: "search",
  args: { query: "alarms" },
  inputHash: "reviewed-input"
} as IntegrationApproval;

function Harness(props: Parameters<typeof useIntegrationApprovals>[0]) {
  const { approvals } = useIntegrationApprovals(props);
  return <p>{approvals.map((item) => item.executionId).join(",")}</p>;
}

function input() {
  return {
    botId: "test",
    botStatus: "idle",
    chatStatus: "ready",
    ready: Promise.resolve(),
    stub: { listIntegrationApprovals: vi.fn(async (): Promise<IntegrationApproval[]> => []) }
  };
}

afterEach(() => vi.restoreAllMocks());

describe("background integration approvals", () => {
  it("loads a new approval while the chat status remains ready", async () => {
    const props = input();
    const view = await renderComponent(<Harness {...props} />);
    props.stub.listIntegrationApprovals.mockResolvedValue([approval]);
    props.botStatus = "needs_approval";
    await view.rerender(<Harness {...props} />);
    expect(view.container.textContent).toBe("docs-test");
    await view.unmount();
  });

  it("waits for the connection before reading pending approvals", async () => {
    const props = input();
    let connect!: () => void;
    props.ready = new Promise<void>((resolve) => {
      connect = resolve;
    });
    props.stub.listIntegrationApprovals.mockResolvedValue([approval]);
    const view = await renderComponent(<Harness {...props} />);
    expect(props.stub.listIntegrationApprovals).not.toHaveBeenCalled();
    await interact(connect);
    expect(view.container.textContent).toBe("docs-test");
    await view.unmount();
  });

  it("retries a failed pending-approval read and stops polling on unmount", async () => {
    const props = input();
    props.botStatus = "needs_approval";
    props.stub.listIntegrationApprovals.mockRejectedValueOnce(new Error("Disconnected"));
    props.stub.listIntegrationApprovals.mockResolvedValue([approval]);
    let retry!: () => void;
    vi.spyOn(window, "setInterval").mockImplementation((callback) => {
      retry = callback as () => void;
      return 123 as unknown as ReturnType<typeof window.setInterval>;
    });
    const clear = vi.spyOn(window, "clearInterval");
    const view = await renderComponent(<Harness {...props} />);
    expect(view.container.textContent).toBe("");
    await interact(retry);
    expect(view.container.textContent).toBe("docs-test");
    await view.unmount();
    expect(clear).toHaveBeenCalledWith(123);
  });

  it("discards a late response from the previous teammate", async () => {
    const props = input();
    let finish!: (value: IntegrationApproval[]) => void;
    props.stub.listIntegrationApprovals.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const view = await renderComponent(<Harness {...props} />);
    props.botId = "another-test";
    await view.rerender(<Harness {...props} />);
    await interact(() => finish([approval]));
    expect(view.container.textContent).toBe("");
    await view.unmount();
  });
});
