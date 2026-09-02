import { contentTypeForUpload } from "../domain/files";
import type { ArtifactReference, BotFile } from "../domain/types";
import { artifactReference, deleteArtifact, saveArtifact } from "../services/artifacts";
import type { LinuxOutputSpec, LinuxRunOptions } from "./linux-run";

const MAX_OUTPUT_FILE_BYTES = 10_000_000;
const MAX_OUTPUT_BYTES = 25_000_000;

export class LinuxOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinuxOutputError";
  }
}

function savedReference(files: Map<string, BotFile>, id: string): ArtifactReference {
  const file = files.get(id);
  if (!file) throw new LinuxOutputError("A saved output file is missing");
  return artifactReference(file);
}

export async function publishLinuxOutputs(
  options: LinuxRunOptions,
  outputRoot: string,
  requested: readonly LinuxOutputSpec[]
): Promise<ArtifactReference[]> {
  const paths = [...new Map(requested.map((path) => [path.relativePath, path])).values()];
  if (paths.length === 0) return [];
  const existing = new Map<string, BotFile>();
  for (const path of paths) {
    const file = await options.catalog.getFile(path.fileId, options.botId);
    if (file) existing.set(path.fileId, file);
  }
  const missing = paths.filter((path) => !existing.has(path.fileId));
  if (missing.length === 0) {
    return paths.map((path) => savedReference(existing, path.fileId));
  }

  const listing = await options.sandbox.listFiles(outputRoot, { recursive: true });
  const available = new Map(listing.files.map((file) => [file.absolutePath, file]));
  let totalSize = [...existing.values()].reduce((total, file) => total + file.size, 0);
  for (const path of missing) {
    const file = available.get(path.absolutePath);
    if (file?.type !== "file") {
      throw new LinuxOutputError(`Output file ${path.name} was not created`);
    }
    if (file.size <= 0 || file.size > MAX_OUTPUT_FILE_BYTES) {
      throw new LinuxOutputError(`Output file ${path.name} must contain 1 byte to 10 MB`);
    }
    totalSize += file.size;
  }
  if (totalSize > MAX_OUTPUT_BYTES) {
    throw new LinuxOutputError("Output files must total 25 MB or less");
  }

  const saved = paths.flatMap((path) => {
    const file = existing.get(path.fileId);
    return file ? [file] : [];
  });
  const created: BotFile[] = [];
  let actualTotalSize = [...existing.values()].reduce((total, file) => total + file.size, 0);
  try {
    for (const path of missing) {
      const result = await options.sandbox.readFile(path.absolutePath, { encoding: "none" });
      const bytes = new Uint8Array(await new Response(result.content).arrayBuffer());
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_OUTPUT_FILE_BYTES) {
        throw new LinuxOutputError(`Output file ${path.name} must contain 1 byte to 10 MB`);
      }
      actualTotalSize += bytes.byteLength;
      if (actualTotalSize > MAX_OUTPUT_BYTES) {
        throw new LinuxOutputError("Output files must total 25 MB or less");
      }
      const file = await saveArtifact({
        body: bytes,
        botId: options.botId,
        bucket: options.bucket,
        catalog: options.catalog,
        contentType: contentTypeForUpload(path.name, result.mimeType),
        id: path.fileId,
        name: path.name,
        size: bytes.byteLength
      });
      saved.push(file);
      created.push(file);
    }
  } catch (cause) {
    await Promise.allSettled(
      created.map((file) => deleteArtifact(options.bucket, options.catalog, file))
    );
    throw cause;
  }
  const byId = new Map(saved.map((file) => [file.id, file]));
  return paths.map((path) => savedReference(byId, path.fileId));
}
