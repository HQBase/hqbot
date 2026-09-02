// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { AgentMessage } from "../../../src/ui/components/chat/agent-message";
import { renderComponent } from "./render";

describe("AgentMessage", () => {
  const durableScreenshot = {
    botId: "bot-1",
    contentType: "image/jpeg",
    createdAt: "2026-08-30T12:05:00.000Z",
    id: "screenshot-1",
    name: "browser-screenshot.jpg",
    size: 1024
  };

  it("renders computer browser screenshot output as an image", async () => {
    const view = await renderComponent(
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[
          {
            type: "tool-browser_execute",
            state: "output-available",
            output: {
              result: {
                readyState: "complete",
                screenshot: {
                  type: "browser_screenshot",
                  mediaType: "image/png",
                  data: "aGVsbG8="
                }
              }
            }
          }
        ]}
      />
    );

    const image = view.container.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("Browser screenshot");
    expect(image?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
    expect(view.container.textContent).toContain("Screenshot captured");
    expect(view.container.textContent).not.toContain("aGVsbG8=");
    await view.unmount();
  });

  it("does not treat arbitrary tool output as an image", async () => {
    const view = await renderComponent(
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[
          {
            type: "tool-browser_execute",
            state: "output-available",
            output: { type: "browser_screenshot", mediaType: "text/html", data: "PGgxPg==" }
          }
        ]}
      />
    );

    expect(view.container.querySelector("img")).toBeNull();
    await view.unmount();
  });

  it("renders the bounded JPEG returned by the direct screenshot tool", async () => {
    const view = await renderComponent(
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[
          {
            type: "tool-browser_screenshot",
            state: "output-available",
            output: {
              type: "browser_screenshot",
              mediaType: "image/jpeg",
              data: "aGVsbG8="
            }
          }
        ]}
      />
    );

    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/jpeg;base64,aGVsbG8="
    );
    await view.unmount();
  });

  it("renders a general desktop screenshot inline", async () => {
    const view = await renderComponent(
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[
          {
            type: "tool-desktop_screenshot",
            state: "output-available",
            output: {
              type: "desktop_screenshot",
              mediaType: "image/jpeg",
              data: "aGVsbG8=",
              width: 1440,
              height: 900
            }
          }
        ]}
      />
    );

    const image = view.container.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("Desktop screenshot");
    expect(image?.getAttribute("src")).toBe("data:image/jpeg;base64,aGVsbG8=");
    expect(view.container.querySelector('[aria-label="Open desktop screenshot"]')).not.toBeNull();
    await view.unmount();
  });

  it("renders a durable computer screenshot through its bot-scoped file URL", async () => {
    const view = await renderComponent(
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[
          {
            type: "tool-browser_screenshot",
            state: "output-available",
            output: {
              artifact: durableScreenshot,
              type: "browser_screenshot",
              url: "https://example.com/"
            }
          }
        ]}
      />
    );

    const link = view.container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open browser screenshot"]'
    );
    expect(link?.getAttribute("href")).toBe("/api/bots/bot-1/files/screenshot-1");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.querySelector("img")?.getAttribute("src")).toBe(
      "/api/bots/bot-1/files/screenshot-1"
    );
    expect(view.container.textContent).not.toContain("base64");
    await view.unmount();
  });

  it("renders generic Linux output files as previewable artifact links", async () => {
    const left = { ...durableScreenshot, id: "left-1", name: "source-left.jpg", size: 512 };
    const right = { ...durableScreenshot, id: "right-1", name: "source-right.jpg", size: 512 };
    const view = await renderComponent(
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[
          {
            type: "tool-bash",
            state: "output-available",
            output: {
              durationMs: 23,
              exitCode: 0,
              files: [left, right],
              stderr: "",
              stdout: "",
              type: "sandbox_command"
            }
          }
        ]}
      />
    );

    const links = [...view.container.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/api/bots/bot-1/files/left-1",
      "/api/bots/bot-1/files/right-1"
    ]);
    expect(links.map((link) => link.querySelector("img")?.getAttribute("src"))).toEqual([
      "/api/bots/bot-1/files/left-1",
      "/api/bots/bot-1/files/right-1"
    ]);
    expect(view.container.textContent).toContain("2 files created");
    await view.unmount();
  });

  it("shows full tool input and output in a native accordion", async () => {
    const view = await renderComponent(
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[
          {
            type: "tool-bash",
            state: "output-available",
            input: { script: "printf 'first\\nsecond\\n'" },
            output: {
              exitCode: 0,
              stderr: "",
              stdout: "first\nsecond\n",
              type: "sandbox_command"
            }
          }
        ]}
      />
    );

    const details = view.container.querySelector<HTMLDetailsElement>('[data-slot="tool-details"]');
    const values = [...view.container.querySelectorAll("pre")].map((node) => node.textContent);
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain("bash");
    expect(values[0]).toBe(JSON.stringify({ script: "printf 'first\\nsecond\\n'" }, null, 2));
    expect(values[1]).toBe(
      JSON.stringify(
        { exitCode: 0, stderr: "", stdout: "first\nsecond\n", type: "sandbox_command" },
        null,
        2
      )
    );
    await view.unmount();
  });

  it("shows a nonzero command exit as failed", async () => {
    const view = await renderComponent(
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[
          {
            type: "tool-bash",
            state: "output-available",
            output: { exitCode: 2, stderr: "bad input", stdout: "", type: "sandbox_command" }
          }
        ]}
      />
    );

    expect(view.container.textContent).toContain("Failed");
    expect(view.container.textContent).not.toContain("Done");
    await view.unmount();
  });

  it("groups reasoning and tools into one agent activity trail", async () => {
    const view = await renderComponent(
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[
          { type: "reasoning", state: "done", text: "I will inspect the page." },
          {
            type: "tool-browser_snapshot",
            state: "output-available",
            input: {},
            output: { title: "Inbox" }
          },
          { type: "text", text: "The inbox is ready." }
        ]}
      />
    );

    expect(view.container.querySelectorAll('[aria-label="Agent activity"]')).toHaveLength(1);
    expect(view.container.textContent).toContain("2 steps");
    expect(view.container.textContent).toContain("Thought process");
    expect(view.container.textContent).toContain("browser_snapshot");
    expect(view.container.textContent).toContain("The inbox is ready.");
    await view.unmount();
  });

  it("keeps streamed activity mounted and open when it completes", async () => {
    const content = (text: string, state: string) => (
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[{ type: "reasoning", state, text }]}
      />
    );
    const view = await renderComponent(content("I will inspect", "streaming"));
    const activity = view.container.querySelector("details");

    expect(activity?.open).toBe(true);
    await view.rerender(content("I inspected the page", "done"));

    expect(view.container.querySelector("details")).toBe(activity);
    expect(activity?.open).toBe(true);
    await view.unmount();
  });

  it("keeps text between tool groups in stream order", async () => {
    const view = await renderComponent(
      <AgentMessage
        name="Teammate"
        speaker="assistant"
        parts={[
          {
            type: "tool-browser_snapshot",
            state: "output-available",
            output: { title: "Inbox" }
          },
          { type: "text", text: "I found the message. I will open it now." },
          {
            type: "tool-browser_click",
            state: "output-available",
            output: { clicked: true }
          }
        ]}
      />
    );

    const sections = [
      ...(view.container.querySelector("article > div.min-w-0 > div.flex")?.children ?? [])
    ];
    expect(view.container.querySelectorAll('[aria-label="Agent activity"]')).toHaveLength(2);
    expect(sections[0]?.textContent).toContain("browser_snapshot");
    expect(sections[1]?.textContent).toContain("I found the message");
    expect(sections[2]?.textContent).toContain("browser_click");
    await view.unmount();
  });
});
