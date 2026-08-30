import {
  type BrowserRuntime,
  type CreateBrowserToolsOptions,
  createBrowserRuntime
} from "@cloudflare/think/tools/browser";

export function createTeammateBrowserRuntime(
  ctx: CreateBrowserToolsOptions["ctx"],
  browser: CreateBrowserToolsOptions["browser"],
  loader: CreateBrowserToolsOptions["loader"],
  teammateId: string
): BrowserRuntime {
  return createBrowserRuntime({
    ctx,
    browser,
    loader,
    name: "hqbot-browser",
    timeout: 25_000,
    session: {
      mode: "reuse",
      key: `teammate:${teammateId}`,
      keepAliveMs: 120_000
    },
    quickActions: {
      actions: ["markdown", "links", "scrape"],
      maxChars: 20_000
    }
  });
}
