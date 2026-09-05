import { expect, it } from "vitest";
import { collectMetrics, evaluationPrompt } from "../../scripts/evaluate.mjs";

const start = Date.parse("2026-09-01T00:00:00Z");
const run = {
  id: "test",
  mode: "soak",
  hours: 24,
  startedAt: new Date(start).toISOString(),
  days: {}
};
const snapshot = {
  costs: { dayStartedAt: "2026-09-01", selectedBot: { estimatedUsd: 0.1 } },
  files: [{ id: "file", name: "hqbot-soak.txt" }]
};
const done = {
  work: { state: "done", generation: 24 },
  milestones: [{ id: "verified", state: "verified", created_at: "2026-09-02T00:00:00Z" }]
};
it("does not treat an early completion or elapsed time alone as a passed soak test", () => {
  expect(collectMetrics(run, snapshot, done, [], {}, start + 3600000).status).toBe(
    "failed_early_completion"
  );
  expect(collectMetrics(run, snapshot, null, [], {}, start + 86400000).status).toBe("running");
  expect(collectMetrics(run, snapshot, done, [], {}, start + 86400000).status).toBe(
    "failed_missing_hourly_milestones"
  );
  const hourly = Array.from({ length: 24 }, (_, index) => ({
    id: String(index),
    state: "waiting",
    created_at: new Date(start + index * 3600000).toISOString()
  }));
  expect(
    collectMetrics(
      run,
      snapshot,
      { ...done, milestones: [...hourly, ...done.milestones] },
      [],
      {},
      start + 86400000
    ).status
  ).toBe("passed");
});
it("keeps separate daily cost totals and never records checkpoint or action content", () => {
  const first = collectMetrics(run, snapshot, done, [], { version: { tag: "one" } }, start);
  const second = collectMetrics(
    first,
    { ...snapshot, costs: { dayStartedAt: "2026-09-02", selectedBot: { estimatedUsd: 0.2 } } },
    { ...done, milestones: [{ ...done.milestones[0], checkpoint: "private" }] },
    [{ connector: "public-docs", state: "applied", result: "private" }],
    { version: { tag: "two" } },
    start + 86400000
  );
  expect(second.metrics.estimatedUsd).toBeCloseTo(0.3);
  expect(second.versions).toEqual(["one", "two"]);
  expect(JSON.stringify(second)).not.toContain("private");
  expect(evaluationPrompt({ ...run, endAt: "fixed" })).toContain("fixed");
});
