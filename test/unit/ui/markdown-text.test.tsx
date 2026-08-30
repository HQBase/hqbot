// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownText } from "../../../src/ui/components/chat/markdown-text";

function render(text: string): string {
  return renderToStaticMarkup(createElement(MarkdownText, { text }));
}

describe("MarkdownText", () => {
  it("renders common agent Markdown and GFM tables", () => {
    const html = render(`**Browser Run**

| Plan | Price |
| --- | --- |
| Paid | $0.09/hour |

- Quick Actions
- Browser Sessions`);

    expect(html).toContain("<strong>Browser Run</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("<li>Quick Actions</li>");
    expect(html).not.toContain("**Browser Run**");
  });

  it("escapes raw HTML and removes unsafe link protocols", () => {
    const html = render('<script>alert("unsafe")</script>\n\n[bad](javascript:alert(1))');

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<a href="">bad</a>');
  });
});
