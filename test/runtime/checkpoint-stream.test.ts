import { expect, it, vi } from "vitest";
import { putCheckpointStream } from "../../src/runtime/checkpoint-stream";
import { installFixedLengthStream } from "../support/fixed-length-stream";

it("streams all backup bytes and rejects a truncated archive", async () => {
  installFixedLengthStream();
  const bytes: string[] = [];
  const bucket = {
    put: vi.fn(async (_key: string, body: ReadableStream) => {
      bytes.push(await new Response(body).text());
    })
  };
  await putCheckpointStream(bucket, "backup", { content: new Blob(["archive"]).stream(), size: 7 });
  expect(bytes).toEqual(["archive"]);
  await expect(
    putCheckpointStream(bucket, "broken", { content: new Blob(["short"]).stream(), size: 7 })
  ).rejects.toThrow("length mismatch");
  expect(bytes).toEqual(["archive"]);
});

it("cancels the archive source if R2 rejects the upload", async () => {
  installFixedLengthStream();
  const cancel = vi.fn();
  const source = new ReadableStream({ cancel });
  await expect(
    putCheckpointStream(
      {
        put: async () => {
          throw new Error("R2 unavailable");
        }
      },
      "backup",
      { content: source, size: 10 }
    )
  ).rejects.toThrow("R2 unavailable");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cancel).toHaveBeenCalledOnce();
});
