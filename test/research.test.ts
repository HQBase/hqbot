import { describe, expect, it } from "vitest";

import { parseResearchPlan, safeResearchUrl } from "../src/domain/research";

describe("safeResearchUrl", () => {
  it("accepts public web URLs and removes fragments", () => {
    expect(safeResearchUrl("https://example.com/report#private")?.toString()).toBe(
      "https://example.com/report"
    );
  });

  it.each([
    "http://localhost/admin",
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/",
    "http://192.168.1.2/",
    "http://172.31.0.1/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://service.internal/",
    "http://service.localhost/",
    "http://single-label/",
    "file:///etc/passwd"
  ])("rejects a private target: %s", (value) => {
    expect(safeResearchUrl(value)).toBeNull();
  });
});

describe("parseResearchPlan", () => {
  it("bounds lists and removes unsafe URLs", () => {
    expect(
      parseResearchPlan(
        {
          goal: "Research this",
          queries: ["one", "two", "three"],
          urls: ["https://example.com/one", "http://localhost/", "https://example.net/two"]
        },
        "fallback"
      )
    ).toEqual({
      goal: "Research this",
      queries: ["one", "two"],
      urls: ["https://example.com/one", "https://example.net/two"]
    });
  });

  it("uses the goal as a search when the model gives no route", () => {
    expect(parseResearchPlan({ goal: "Find current evidence" }, "fallback").queries).toEqual([
      "Find current evidence"
    ]);
  });
});
