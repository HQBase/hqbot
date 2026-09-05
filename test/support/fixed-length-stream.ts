import { vi } from "vitest";

export function installFixedLengthStream() {
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(length: number) {
        let received = 0;
        super({
          transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > length) throw new Error("Fixed length exceeded");
            controller.enqueue(chunk);
          },
          flush() {
            if (received !== length) throw new Error("Fixed length mismatch");
          }
        });
      }
    }
  );
}
