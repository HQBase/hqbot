import { safeFileName } from "../domain/files";
import type { ArtifactReference, BotFile } from "../domain/types";

export interface ArtifactCatalog {
  createFile(input: {
    id: string;
    botId: string;
    key: string;
    name: string;
    contentType: string;
    size: number;
  }): Promise<BotFile>;
  deleteFile(id: string, botId: string): Promise<BotFile | null>;
  getFile(id: string, botId: string): Promise<BotFile | null>;
  listFiles(botId: string): Promise<BotFile[]>;
}

type ArtifactBody = ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob;

export interface ArtifactObject {
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

export interface ArtifactBucket {
  delete(key: string): Promise<void>;
  get(key: string): Promise<ArtifactObject | null>;
  put(
    key: string,
    value: ArtifactBody,
    options: { httpMetadata: { contentType: string } }
  ): Promise<unknown>;
}

export function artifactReference(file: BotFile): ArtifactReference {
  const { id, botId, name, contentType, size, createdAt } = file;
  return { id, botId, name, contentType, size, createdAt };
}

export async function saveArtifact(input: {
  body: ArtifactBody;
  botId: string;
  bucket: ArtifactBucket;
  catalog: ArtifactCatalog;
  contentType: string;
  id?: string;
  name: string;
  size: number;
}): Promise<BotFile> {
  const id = input.id ?? crypto.randomUUID();
  const name = safeFileName(input.name);
  const key = `files/${input.botId}/${id}/${name}`;
  await input.bucket.put(key, input.body, { httpMetadata: { contentType: input.contentType } });
  try {
    return await input.catalog.createFile({
      id,
      botId: input.botId,
      key,
      name,
      contentType: input.contentType,
      size: input.size
    });
  } catch (cause) {
    try {
      const existing = await input.catalog.getFile(id, input.botId);
      if (existing) return existing;
    } catch {
      // Keep the object when a committed catalog write cannot be ruled out.
      throw cause;
    }
    await input.bucket.delete(key);
    throw cause;
  }
}

export async function deleteArtifact(
  bucket: ArtifactBucket,
  catalog: ArtifactCatalog,
  file: BotFile
): Promise<void> {
  await catalog.deleteFile(file.id, file.botId);
  await bucket.delete(file.key);
}

export function bytesFromBase64(value: string): Uint8Array {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}
