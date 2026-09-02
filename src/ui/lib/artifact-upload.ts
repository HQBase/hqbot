import type { ArtifactReference, BotFile } from "../../domain/types";
import { api } from "./api";

export function uploadArtifacts(botId: string, files: File[]): Promise<BotFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const form = new FormData();
      form.set("file", file);
      const result = await api<{ file: BotFile }>(`/api/bots/${encodeURIComponent(botId)}/files`, {
        body: form,
        method: "POST"
      });
      return result.file;
    })
  );
}

export function artifactReferences(files: BotFile[]): ArtifactReference[] {
  return files.map(({ id, botId, name, contentType, size, createdAt }) => ({
    id,
    botId,
    name,
    contentType,
    size,
    createdAt
  }));
}
