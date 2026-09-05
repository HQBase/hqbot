import { useEffect, useState } from "react";
import { PiFile } from "react-icons/pi";
import type { ArtifactReference } from "../../../domain/types";
import { fileUrl } from "../../lib/files";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

export function previewKind(contentType: string): "image" | "video" | "text" | "download" {
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(contentType)) return "image";
  if (["video/webm", "video/mp4"].includes(contentType)) return "video";
  if (
    contentType.startsWith("text/") ||
    ["application/json", "application/xml", "image/svg+xml"].includes(contentType)
  )
    return "text";
  return "download";
}
export function FilePreview({
  file,
  thumbnail = false
}: {
  file: ArtifactReference;
  thumbnail?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Preview ${file.name}`}
        className="flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-divider bg-muted/40 px-3 py-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
      >
        {thumbnail && previewKind(file.contentType) === "image" && (
          <img alt={file.name} src={fileUrl(file)} className="max-h-72 w-full object-contain" />
        )}
        <PiFile className="shrink-0" />
        <span className="truncate">{file.name}</span>
      </button>
      {open && <FilePreviewDialog file={file} onClose={() => setOpen(false)} />}
    </>
  );
}
function FilePreviewDialog({ file, onClose }: { file: ArtifactReference; onClose: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const kind = previewKind(file.contentType);
  useEffect(() => {
    if (kind !== "text") return;
    const abort = new AbortController();
    void (async () => {
      const response = await fetch(fileUrl(file), {
        signal: abort.signal,
        credentials: "same-origin"
      });
      if (!response.ok || !response.body) throw new Error("The preview could not load");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      try {
        while (size < 200000) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const take = chunk.value.slice(0, 200000 - size);
          chunks.push(take);
          size += take.length;
          if (take.length < chunk.value.length) {
            truncated = true;
            break;
          }
        }
        if (size === 200000) truncated = true;
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      if (!abort.signal.aborted)
        setText(
          new TextDecoder().decode(bytes) +
            (truncated ? "\n\n[Preview ends here. Download the full file.]" : "")
        );
    })().catch((cause) => {
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : "The preview could not load");
    });
    return () => abort.abort();
  }, [file, kind]);
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle className="break-words pr-8">{file.name}</DialogTitle>
        <DialogDescription>
          {Math.ceil(file.size / 1000)} KB ·{" "}
          {kind === "text"
            ? "Safe text preview"
            : kind === "download"
              ? "Download to open this file"
              : "File preview"}
        </DialogDescription>
        {kind === "image" ? (
          <img
            alt={file.name}
            src={fileUrl(file)}
            className="max-h-[65dvh] w-full object-contain"
          />
        ) : kind === "video" ? (
          <video
            aria-label={file.name}
            controls
            src={fileUrl(file)}
            className="max-h-[65dvh] w-full"
          >
            <track kind="captions" />
          </video>
        ) : kind === "text" ? (
          <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-xs">
            {text || "Loading preview…"}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            This file type is available as a download.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button asChild variant="outline">
          <a href={fileUrl(file, true)}>Download original</a>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
