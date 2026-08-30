import { describe, expect, it } from "vitest";

import { needsReplyApproval } from "../src/domain/approval";

describe("reply approval", () => {
  it("requires approval for email replies by default", () => {
    expect(needsReplyApproval("email", false)).toBe(true);
  });

  it("does not pause chat or an explicit auto-reply installation", () => {
    expect(needsReplyApproval("chat", false)).toBe(false);
    expect(needsReplyApproval("email", true)).toBe(false);
  });
});
