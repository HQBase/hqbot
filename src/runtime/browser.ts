import {
  type BrowserRuntime,
  type CreateBrowserToolsOptions,
  createBrowserRuntime
} from "@cloudflare/think/tools/browser";
import {
  DurableBrowserSessionStore,
  type LiveViewMode,
  type QuickActionBinding
} from "agents/browser";

import {
  type BrowserSessionLease,
  type BrowserUsageSample,
  estimateBrowserMicroUsd,
  MeteredBrowserSessionStore,
  meteredBrowserBinding
} from "./browser-meter";
import type { WorkspaceAgentRpc } from "./types";

export type { BrowserSessionLease } from "./browser-meter";

export const BROWSER_KEEP_ALIVE_MS = 120_000;

export interface MeteredBrowserRuntime extends BrowserRuntime {
  meter: MeteredBrowserSessionStore;
}

export function createTeammateBrowserRuntime(
  ctx: NonNullable<CreateBrowserToolsOptions["ctx"]>,
  browser: CreateBrowserToolsOptions["browser"],
  loader: CreateBrowserToolsOptions["loader"],
  teammateId: string,
  taskId: () => unknown,
  workspaceAgent: WorkspaceAgentRpc
): MeteredBrowserRuntime {
  const currentTaskId = () => {
    const value = taskId();
    return typeof value === "string" ? value : null;
  };
  const record = (sample: BrowserUsageSample) =>
    workspaceAgent.recordResourceUsage({
      eventId: sample.eventId,
      botId: teammateId,
      taskId: sample.taskId,
      service: "browser",
      units: sample.milliseconds,
      estimatedCostMicroUsd: estimateBrowserMicroUsd(sample.milliseconds)
    });
  const binding = meteredBrowserBinding(
    browser as NonNullable<CreateBrowserToolsOptions["browser"]> & QuickActionBinding,
    currentTaskId,
    record
  );
  const meter = new MeteredBrowserSessionStore(
    new DurableBrowserSessionStore(ctx.storage),
    ctx.storage,
    currentTaskId,
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

export async function openBrowserLiveView(
  runtime: MeteredBrowserRuntime,
  mode: LiveViewMode,
  arm: (leases: BrowserSessionLease[]) => Promise<void>
) {
  const view = (await runtime.connector.liveView({ mode })) ?? null;
  await runtime.meter.flush();
  if (view) await arm(await runtime.meter.touch(null, view.sessionId));
  return view;
}

export async function keepBrowserLiveViewAlive(
  runtime: MeteredBrowserRuntime,
  sessionId: string,
  taskId: string | null,
  arm: (leases: BrowserSessionLease[]) => Promise<void>
): Promise<boolean> {
  const info = await runtime.connector.sessionInfo();
  await runtime.meter.flush();
  if (!info || info.sessionId !== sessionId) return false;
  const leases = await runtime.meter.touch(taskId, sessionId);
  await arm(leases);
  return leases.length > 0;
}

export function closeBrowserSession(runtime: MeteredBrowserRuntime): Promise<void> {
  return runtime.meter.closeSession(() => runtime.connector.closeSession());
}

export async function settleBrowserLease(
  runtime: MeteredBrowserRuntime,
  payload: BrowserSessionLease,
  arm: (leases: BrowserSessionLease[]) => Promise<void>
): Promise<void> {
  const lease = (await runtime.meter.leases(payload.sessionId))[0];
  if (!lease) return;
  if (lease.deadline > Date.now()) return arm([lease]);

  const info = await runtime.connector.sessionInfo();
  await runtime.meter.flush();
  if (!info || info.sessionId !== payload.sessionId) return;
  const current = (await runtime.meter.leases(payload.sessionId))[0];
  if (!current) return;
  if (current.deadline > Date.now()) return arm([current]);
  await closeBrowserSession(runtime);
}

export async function scheduleBrowserLeases(
  leases: BrowserSessionLease[],
  schedule: (when: Date, lease: BrowserSessionLease) => Promise<unknown>
): Promise<void> {
  for (const lease of leases) {
    const when = new Date(Math.max(Date.now() + 1_000, lease.deadline));
    await schedule(when, lease);
  }
}
