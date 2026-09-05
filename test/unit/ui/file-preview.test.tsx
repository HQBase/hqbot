// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { FilePreview, previewKind } from "../../../src/ui/components/chat/file-preview";
import { interact, renderComponent } from "./render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.textContent = "";
});
it("classifies executable formats as text or downloads", () => {
  expect(previewKind("image/svg+xml")).toBe("text");
  expect(previewKind("text/html")).toBe("text");
  expect(previewKind("application/xhtml+xml")).toBe("download");
  expect(previewKind("image/png")).toBe("image");
});
it("shows hostile HTML as text without executing or embedding it", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          '<script>window.previewAttack=true</script><img src="https://outside.test/track">'
        )
      )
  );
  const rendered = await renderComponent(
    <FilePreview
      file={{
        id: "file",
        botId: "bot",
        name: "report.html",
        contentType: "text/html",
        size: 100,
        createdAt: ""
      }}
    />
  );
  await interact(() => rendered.container.querySelector<HTMLButtonElement>("button")?.click());
  await vi.waitFor(() => expect(document.querySelector("pre")?.textContent).toContain("<script>"));
  expect(document.querySelector("script, iframe, img")).toBeNull();
  expect(document.querySelector("a")?.getAttribute("href")).toContain("download=1");
  await rendered.unmount();
});
