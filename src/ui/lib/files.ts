import type { BotFile } from "../../domain/types";

type FileIdentity = Pick<BotFile, "botId" | "id">;

export function fileUrl(file: FileIdentity, download = false): string {
  const path = `/api/bots/${encodeURIComponent(file.botId)}/files/${encodeURIComponent(file.id)}`;
  return download ? `${path}?download=1` : path;
}
