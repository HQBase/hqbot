import { micromark } from "micromark";

export function messagePreview(text: string): string {
  const template = document.createElement("template");
  // The detached template is inert; Micromark escapes raw HTML by default.
  template.innerHTML = micromark(text);
  return (template.content.textContent ?? "").replace(/\s+/gu, " ").trim();
}
