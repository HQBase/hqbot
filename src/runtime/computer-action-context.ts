import type { TeammateComputer } from "./computer";

export interface BrowserActionContext {
  url: string;
  title: string;
  target: {
    name: string;
    tag: string;
    role: string;
    expanded?: string;
    hasPopup?: string;
    type: string;
    href: string;
    autocomplete: string;
    form: string;
  } | null;
}
export const browserTargetActions = new Set(["browser_click", "browser_type", "browser_press"]);
export async function readBrowserActionContext(
  computer: TeammateComputer,
  input: Record<string, unknown>
): Promise<BrowserActionContext> {
  await computer.assertModelControlAvailable();
  // This reads the current referenced element without changing refs or reading field values.
  const script = `(() => {
    const ref = ${JSON.stringify(input.ref)};
    const e = document.querySelector('[data-hqbot-ref="' + ref + '"]');
    const clean = value => String(value || '').trim().replace(/\\s+/g, ' ').slice(0, 300);
    const name = e => clean(e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.getAttribute('placeholder') || e.getAttribute('name'));
    return { url: location.href, title: document.title, target: e ? {
      name: name(e), tag: e.tagName.toLowerCase(), role: clean(e.getAttribute('role')),
      expanded: clean(e.getAttribute('aria-expanded')), hasPopup: clean(e.getAttribute('aria-haspopup')),
      type: clean(e.getAttribute('type')), href: clean(e.href), autocomplete: clean(e.getAttribute('autocomplete')),
      form: clean(e.closest('form')?.getAttribute('aria-label')) + ' ' + [...(e.closest('form')?.querySelectorAll('button,[type=submit]') || [])].map(name).join(', ')
    } : null };
  })()`;
  const result = await computer.sandbox().exec("/usr/local/bin/hqbot-browser-control", {
    env: {
      HQBOT_BROWSER_INPUT: JSON.stringify({
        action: "evaluate",
        script,
        ...(input.targetId ? { targetId: input.targetId } : {})
      })
    },
    timeout: 15_000
  });
  if (result.exitCode !== 0) throw new Error("The browser target could not be checked");
  const value = JSON.parse(result.stdout).result as BrowserActionContext;
  if (!value || typeof value.url !== "string" || !value.target || !value.target.name)
    throw new Error(
      "The browser target is unavailable. Inspect the page again before requesting this action."
    );
  return value;
}
