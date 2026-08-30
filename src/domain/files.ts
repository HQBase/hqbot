const textTypes: Record<string, string> = {
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
  text: "text/plain",
  txt: "text/plain",
  xml: "application/xml",
}

export function contentTypeForUpload(name: string, reportedType: string): string {
  if (reportedType) return reportedType
  const extension = name.split(".").pop()?.toLowerCase() ?? ""
  return textTypes[extension] ?? "application/octet-stream"
}
