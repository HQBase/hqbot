const textTypes: Record<string, string> = {
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
  text: "text/plain",
  txt: "text/plain",
  xml: "application/xml"
};

export function safeFileName(value: string): string {
  const name = value
    .replace(/[^a-zA-Z0-9._ -]/gu, "_")
    .slice(0, 120)
    .trim();
  return !name || name === "." || name === ".." ? "attachment" : name;
}

export function contentTypeForUpload(name: string, reportedType: string): string {
  const normalized = reportedType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  if (["text/html", "application/xhtml+xml", "image/svg+xml"].includes(normalized)) {
    return "text/plain";
  }
  if (normalized) return normalized;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return textTypes[extension] ?? "application/octet-stream";
}
