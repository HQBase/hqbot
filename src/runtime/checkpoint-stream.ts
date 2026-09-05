export async function putCheckpointStream(
  bucket: {
    put(
      key: string,
      body: ReadableStream,
      options: { httpMetadata: { contentType: string } }
    ): Promise<unknown>;
  },
  key: string,
  file: { content: ReadableStream; size: number }
): Promise<void> {
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw new Error("The backup size is invalid");
  // R2 needs a known length. RPC streams from Sandbox do not preserve that metadata.
  const stream = new FixedLengthStream(file.size);
  const controller = new AbortController();
  const upload = bucket
    .put(key, stream.readable, { httpMetadata: { contentType: "application/gzip" } })
    .catch((cause) => {
      controller.abort(cause);
      throw cause;
    });
  const copying = file.content.pipeTo(stream.writable, { signal: controller.signal });
  await Promise.all([upload, copying]);
}
