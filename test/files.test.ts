import { describe, expect, it } from "vitest";

import { contentTypeForUpload } from "../src/domain/files";

describe("uploaded files", () => {
  it("keeps a reported content type", () => {
    expect(contentTypeForUpload("notes.md", "text/custom")).toBe("text/custom");
    expect(contentTypeForUpload("page.html", "text/html; charset=utf-8")).toBe("text/plain");
    expect(contentTypeForUpload("image.svg", "image/svg+xml")).toBe("text/plain");
  });

  it("recognizes text files when the client omits a type", () => {
    expect(contentTypeForUpload("notes.md", "")).toBe("text/markdown");
    expect(contentTypeForUpload("data.JSON", "")).toBe("application/json");
  });
});
