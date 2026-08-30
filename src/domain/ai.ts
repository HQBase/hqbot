function contentText(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (!Array.isArray(value)) return ""
  return value
    .map((part) => {
      if (typeof part !== "object" || part === null) return ""
      const text = (part as Record<string, unknown>).text
      return typeof text === "string" ? text.trim() : ""
    })
    .filter(Boolean)
    .join("\n")
}

export function responseText(value: Record<string, unknown>): string {
  for (const candidate of [value.response, value.result, value.output_text]) {
    const text = contentText(candidate)
    if (text) return text
  }
  const choice = Array.isArray(value.choices) ? value.choices[0] : null
  if (typeof choice === "object" && choice !== null) {
    const record = choice as Record<string, unknown>
    const message =
      typeof record.message === "object" && record.message !== null
        ? (record.message as Record<string, unknown>)
        : null
    const text = contentText(message?.content ?? record.text)
    if (text) return text
  }
  throw new Error("Workers AI returned no text")
}
