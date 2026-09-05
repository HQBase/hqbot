// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { TeamWorkspace } from "../../../src/ui/components/team/team-workspace";
import { renderComponent } from "./render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.textContent = "";
});
it("shows shared work to a viewer without send, stop, or administration controls", async () => {
  const user = { id: "viewer", username: "Alex", role: "viewer" };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path === "/api/team/workspace"
              ? { user, bots: [{ id: "shared", name: "Researcher", status: "idle" }], projects: [] }
              : {
                  messages: {
                    items: [{ id: "answer", role: "assistant", text: "Verified result" }],
                    truncated: false
                  },
                  files: []
                }
          ),
          { headers: { "Content-Type": "application/json" } }
        )
    )
  );
  const view = await renderComponent(<TeamWorkspace onSignedOut={vi.fn()} />);
  await vi.waitFor(() => expect(view.container.textContent).toContain("Verified result"));
  expect(view.container.querySelector("textarea")).toBeNull();
  const controls = [...view.container.querySelectorAll("button")].map((item) => item.textContent);
  expect(controls).not.toContain("Stop");
  expect(controls).not.toContain("People");
  await view.unmount();
});
