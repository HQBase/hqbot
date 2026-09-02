import { PiFile } from "react-icons/pi";

import type { ArtifactReference } from "../../../domain/types";
import { fileUrl } from "../../lib/files";

export function computerScreenshot(value: unknown): { label: string; url: string } | null {
  let candidate = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return null;
    const result = candidate as Record<string, unknown>;
    const label =
      result.type === "desktop_screenshot" ? "Desktop screenshot" : "Browser screenshot";
    const screenshot = result.type === "browser_screenshot" || result.type === "desktop_screenshot";
    const artifact = artifactReferenceFrom(result.artifact);
    if (screenshot && artifact) {
      return { label, url: fileUrl(artifact) };
    }
    if (
      screenshot &&
      (result.mediaType === "image/png" || result.mediaType === "image/jpeg") &&
      typeof result.data === "string" &&
      /^[A-Za-z0-9+/]*={0,2}$/u.test(result.data)
    ) {
      return { label, url: `data:${result.mediaType};base64,${result.data}` };
    }
    candidate = result.screenshot ?? result.result;
  }
  return null;
}

function artifactReferenceFrom(value: unknown): ArtifactReference | null {
  if (!value || typeof value !== "object") return null;
  const file = value as Record<string, unknown>;
  if (
    typeof file.id !== "string" ||
    typeof file.botId !== "string" ||
    typeof file.name !== "string" ||
    typeof file.contentType !== "string" ||
    typeof file.size !== "number"
  ) {
    return null;
  }
  return {
    id: file.id,
    botId: file.botId,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    createdAt: typeof file.createdAt === "string" ? file.createdAt : ""
  };
}

export function artifactReferences(value: unknown): ArtifactReference[] {
  return Array.isArray(value)
    ? value.flatMap((candidate) => {
        const file = artifactReferenceFrom(candidate);
        return file ? [file] : [];
      })
    : [];
}

export function artifactFiles(value: unknown): ArtifactReference[] {
  let candidate = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!candidate || typeof candidate !== "object") return [];
    const result = candidate as Record<string, unknown>;
    const files = artifactReferences(result.files);
    if (files.length > 0) return files;
    candidate = result.result;
  }
  return [];
}

export function ArtifactLinks({
  files,
  previews = false
}: {
  files: ArtifactReference[];
  previews?: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <div className={previews ? "grid gap-2 sm:grid-cols-2" : "flex flex-wrap gap-2"}>
      {files.map((file) => (
        <a
          className="overflow-hidden rounded-lg border border-divider bg-muted/40 text-xs hover:bg-muted"
          href={fileUrl(file)}
          key={file.id}
          rel="noreferrer"
          target="_blank"
        >
          {previews && file.contentType.startsWith("image/") ? (
            <img alt={file.name} className="max-h-72 w-full object-contain" src={fileUrl(file)} />
          ) : null}
          <span className="flex items-center gap-2 px-2.5 py-2">
            <PiFile className="shrink-0" />
            <span className="truncate">{file.name}</span>
          </span>
        </a>
      ))}
    </div>
  );
}
