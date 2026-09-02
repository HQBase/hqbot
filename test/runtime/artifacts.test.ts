import { describe, expect, it, vi } from "vitest";

import type { BotFile } from "../../src/domain/types";
import {
  type ArtifactBucket,
  type ArtifactCatalog,
  saveArtifact
} from "../../src/services/artifacts";

const createdAt = "2026-08-30T12:00:00.000Z";

function botFile(input: Parameters<ArtifactCatalog["createFile"]>[0]): BotFile {
  return { ...input, createdAt, taskId: null };
}

function createCatalog(files: BotFile[] = []) {
  const current = [...files];
  const createFile = vi.fn<ArtifactCatalog["createFile"]>(async (input) => {
    const file = botFile(input);
    current.unshift(file);
    return file;
  });
  const deleteFile = vi.fn<ArtifactCatalog["deleteFile"]>(async (id, botId) => {
    const index = current.findIndex((file) => file.id === id && file.botId === botId);
    return index < 0 ? null : (current.splice(index, 1)[0] ?? null);
  });
  const getFile = vi.fn<ArtifactCatalog["getFile"]>(
    async (id, botId) => current.find((file) => file.id === id && file.botId === botId) ?? null
  );
  const listFiles = vi.fn<ArtifactCatalog["listFiles"]>(async (botId) =>
    current.filter((file) => file.botId === botId)
  );
  return {
    catalog: { createFile, deleteFile, getFile, listFiles } satisfies ArtifactCatalog,
    createFile,
    deleteFile,
    getFile
  };
}

function createBucket(entries: Array<[string, Uint8Array]> = []) {
  const objects = new Map(entries);
  const put = vi.fn<ArtifactBucket["put"]>(async (key, value) => {
    if (!(value instanceof Uint8Array)) throw new Error("Test expected byte input");
    objects.set(key, new Uint8Array(value));
  });
  const get = vi.fn<ArtifactBucket["get"]>(async (key) => {
    const value = objects.get(key);
    return value
      ? {
          bytes: async () => new Uint8Array(value),
          text: async () => new TextDecoder().decode(value)
        }
      : null;
  });
  const remove = vi.fn<ArtifactBucket["delete"]>(async (key) => {
    objects.delete(key);
  });
  return {
    bucket: { delete: remove, get, put } satisfies ArtifactBucket,
    objects,
    put,
    remove
  };
}

describe("artifact storage", () => {
  it("uses a safe name in both R2 and the catalog", async () => {
    const { bucket, put } = createBucket();
    const { catalog, createFile } = createCatalog();

    const file = await saveArtifact({
      body: new Uint8Array([1, 2, 3]),
      botId: "bot-1",
      bucket,
      catalog,
      contentType: "image/png",
      id: "file-1",
      name: "../../folder/file?.png",
      size: 3
    });

    expect(file.name).toBe(".._.._folder_file_.png");
    expect(put).toHaveBeenCalledWith(
      "files/bot-1/file-1/.._.._folder_file_.png",
      expect.any(Uint8Array),
      { httpMetadata: { contentType: "image/png" } }
    );
    expect(createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "files/bot-1/file-1/.._.._folder_file_.png",
        name: ".._.._folder_file_.png"
      })
    );
  });

  it("removes the R2 object when catalog creation fails", async () => {
    const { bucket, objects, remove } = createBucket();
    const { catalog, createFile } = createCatalog();
    const failure = new Error("Catalog unavailable");
    createFile.mockRejectedValueOnce(failure);

    await expect(
      saveArtifact({
        body: new Uint8Array([1]),
        botId: "bot-1",
        bucket,
        catalog,
        contentType: "text/plain",
        id: "file-1",
        name: "note.txt",
        size: 1
      })
    ).rejects.toBe(failure);

    expect(remove).toHaveBeenCalledWith("files/bot-1/file-1/note.txt");
    expect(objects.size).toBe(0);
  });

  it("keeps R2 when the catalog committed but its reply was lost", async () => {
    const { bucket, objects, remove } = createBucket();
    const { catalog, createFile, getFile } = createCatalog();
    const committed = botFile({
      botId: "bot-1",
      contentType: "text/plain",
      id: "file-1",
      key: "files/bot-1/file-1/note.txt",
      name: "note.txt",
      size: 1
    });
    createFile.mockRejectedValueOnce(new Error("Reply lost"));
    getFile.mockResolvedValueOnce(committed);

    await expect(
      saveArtifact({
        body: new Uint8Array([1]),
        botId: "bot-1",
        bucket,
        catalog,
        contentType: "text/plain",
        id: "file-1",
        name: "note.txt",
        size: 1
      })
    ).resolves.toEqual(committed);

    expect(remove).not.toHaveBeenCalled();
    expect(objects.has("files/bot-1/file-1/note.txt")).toBe(true);
  });
});
