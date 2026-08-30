import { describe, expect, it } from "vitest";

import { decryptConnectionToken, encryptConnectionToken } from "../src/services/crypto";

describe("connection encryption", () => {
  it("round trips a credential and rejects a different key", async () => {
    const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const otherKey = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const encrypted = await encryptConnectionToken(key, "hqb_agent_secret");

    await expect(decryptConnectionToken(key, encrypted.ciphertext, encrypted.iv)).resolves.toBe(
      "hqb_agent_secret"
    );
    await expect(
      decryptConnectionToken(otherKey, encrypted.ciphertext, encrypted.iv)
    ).rejects.toThrow();
  });
});
