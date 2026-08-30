// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CostSnapshot, CostTotal } from "../../../src/domain/types";
import { CostPanel } from "../../../src/ui/components/details/cost-panel";

const empty: CostTotal = { estimatedUsd: 0, inputUnits: 0, outputUnits: 0 };

function snapshot(selectedBotHqbaseRealtime: boolean): CostSnapshot {
  return {
    dayStartedAt: "2026-08-30T00:00:00.000Z",
    overall: { estimatedUsd: 1.25, inputUnits: 0, outputUnits: 0 },
    platform: {
      durableObjectGbSecondsPerDay: 1234.5678,
      hqbaseRealtimeConnections: 2,
      selectedBotHqbaseRealtime,
      resources: {
        overall: {
          durableObjects: 4,
          agentSchedules: 8,
          taskSubmissionsToday: 10,
          r2FileObjects: 12,
          r2FileBytes: 4_096
        },
        selectedBot: {
          durableObjects: 1,
          agentSchedules: 3,
          taskSubmissionsToday: 4,
          r2FileObjects: 5,
          r2FileBytes: 2_048
        }
      }
    },
    selectedBot: { estimatedUsd: 0.15, inputUnits: 0, outputUnits: 0 },
    selectedTask: { estimatedUsd: 0.01, inputUnits: 0, outputUnits: 0 },
    services: {
      overall: { browser: empty, workersAi: empty },
      selectedBot: {
        browser: { estimatedUsd: 0.04, inputUnits: 90, outputUnits: 0 },
        workersAi: { estimatedUsd: 0.11, inputUnits: 12345, outputUnits: 678 }
      },
      selectedTask: { browser: empty, workersAi: empty }
    }
  };
}

function renderCostPanel(costs: CostSnapshot): string {
  return renderToStaticMarkup(
    createElement(CostPanel, {
      budgetUsd: 1,
      costs
    })
  );
}

describe("CostPanel", () => {
  it("keeps the three totals and separates AI tokens from browser use", () => {
    const html = renderCostPanel(snapshot(true));

    expect(html).toContain("Task");
    expect(html).toContain("$0.01");
    expect(html).toContain("Teammate");
    expect(html).toContain("$0.15");
    expect(html).toContain("Overall");
    expect(html).toContain("$1.25");
    expect(html).toContain("12,345 in · 678 out");
    expect(html).toContain("90 seconds");
    expect(html).toContain("$0.11");
    expect(html).toContain("$0.04");
  });

  it("does not add a separate HQBase usage section", () => {
    const connected = renderCostPanel(snapshot(true));
    const disconnected = renderCostPanel(snapshot(false));

    expect(connected).not.toContain("HQBase realtime");
    expect(connected).not.toContain("GB-s/day");
    expect(disconnected).not.toContain("HQBase realtime");
    expect(disconnected).not.toContain("GB-s/day");
  });

  it("shows raw Cloudflare resources for the teammate and overall workspace", () => {
    const html = renderCostPanel(snapshot(true));

    expect(html).toContain("Raw Cloudflare footprint");
    expect(html).toContain("Tracked, not billing");
    expect(html).toContain("Durable Objects");
    expect(html).toContain("Agent schedules");
    expect(html).toContain("Tasks today");
    expect(html).toContain("Tracked R2 files");
    expect(html).toContain("5 · 2 KiB");
    expect(html).toContain("12 · 4 KiB");
  });
});
