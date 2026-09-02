import { describe, expect, it, vi } from "vitest";

import { clearLegacyScreenshotReplayError } from "../../src/runtime/screenshot-replay-recovery";

function storage(body: string | null) {
  return {
    delete: vi.fn(async () => undefined),
    get: vi.fn(async () => (body === null ? undefined : { body, requestId: "turn-1" }))
  };
}

describe("screenshot replay recovery", () => {
  it("clears the terminal error left by the old screenshot replay bug", async () => {
    const state = storage(
      'data: {"type":"error","errorText":"atob() called with invalid base64-encoded data."}'
    );

    await expect(clearLegacyScreenshotReplayError(state)).resolves.toBe(true);
    expect(state.delete).toHaveBeenCalledWith("cf:chat:last-terminal");
  });

  it("keeps unrelated terminal errors", async () => {
    const state = storage('data: {"type":"error","errorText":"The provider is unavailable"}');

    await expect(clearLegacyScreenshotReplayError(state)).resolves.toBe(false);
    expect(state.delete).not.toHaveBeenCalled();
  });
});
