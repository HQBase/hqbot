import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { useMemo } from "react";

import { cn } from "../../lib/cn";

export function MarkdownText({ text, user = false }: { text: string; user?: boolean }) {
  const html = useMemo(
    () =>
      micromark(text, {
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()]
      }),
    [text]
  );

  return (
    <div
      className={cn("message-markdown text-[14px] leading-6", user && "message-markdown-user")}
      // Micromark escapes raw HTML and removes unsafe link protocols by default.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the Markdown compiler returns safe HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
