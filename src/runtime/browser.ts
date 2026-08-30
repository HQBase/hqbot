import {
  type BrowserRuntime,
  type CreateBrowserToolsOptions,
  createBrowserRuntime
} from "@cloudflare/think/tools/browser";
import { DurableBrowserSessionStore, type QuickActionBinding } from "agents/browser";

import {
  type BrowserUsageSample,
  MeteredBrowserSessionStore,
  meteredBrowserBinding
} from "./browser-meter";

export { estimateBrowserMicroUsd } from "./browser-meter";

export const BROWSER_KEEP_ALIVE_MS = 120_000;

export interface MeteredBrowserRuntime extends BrowserRuntime {
  meter: MeteredBrowserSessionStore;
}

export function createTeammateBrowserRuntime(
  ctx: NonNullable<CreateBrowserToolsOptions["ctx"]>,
  browser: CreateBrowserToolsOptions["browser"],
  loader: CreateBrowserToolsOptions["loader"],
  teammateId: string,
  taskId: () => string | null,
  record: (sample: BrowserUsageSample) => Promise<void>
): MeteredBrowserRuntime {
  const binding = meteredBrowserBinding(
    browser as NonNullable<CreateBrowserToolsOptions["browser"]> & QuickActionBinding,
    taskId,
    record
  );
  const meter = new MeteredBrowserSessionStore(
    new DurableBrowserSessionStore(ctx.storage),
    ctx.storage,
    taskId,
    record,
    BROWSER_KEEP_ALIVE_MS
  );
  const runtime = createBrowserRuntime({
    ctx,
    browser: binding,
    loader,
    name: "hqbot-browser",
    timeout: 25_000,
    store: meter,
    session: {
      mode: "reuse",
      key: `teammate:${teammateId}`,
      keepAliveMs: BROWSER_KEEP_ALIVE_MS
    },
    quickActions: {
      actions: ["markdown", "links", "scrape"],
      browser: binding,
      maxChars: 20_000
    }
  });
  return { ...runtime, meter };
}
