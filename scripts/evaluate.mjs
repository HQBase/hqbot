import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function evaluationPrompt(run) {
  const criteria = `Save completion criteria with manage_task: id=report, description=Verified saved test report, artifactName=hqbot-${run.mode}.txt. Keep these criteria for this task.`;
  const deliver = `Create /workspace/hqbot/hqbot-${run.mode}.txt with the marker ${run.id}, actual UTC times, and a brief account of the checks you performed. Save it with upload_file, verify it, and finish with manage_task done and artifact evidence. Request approval for each computer action that needs it.`;
  if (run.mode === "smoke")
    return `Run the HQBot deployed acceptance test in this dedicated test teammate. ${criteria} Discover the connected public Cloudflare Documentation MCP server. Use it to find the official Durable Objects alarm documentation. Request approval for the exact remote call and wait. After approval, use the returned documentation in the report with its source URL. ${deliver} Do not use any other connection or personal data.`;
  return `Run a ${run.hours} hour autonomous endurance test. ${criteria} The fixed end time is ${run.endAt}. Until that time, save a new numbered milestone with the actual UTC time each hour and use schedule create_once for the next wake-up. Keep the same task and fixed end time. Each checkpoint must include the milestone number, all previous milestone times, and the next step so it survives compaction. Do not create recurring schedules. Do not finish early or keep an idle computer running. After the end time, ${deliver} Include every milestone time in the report. Do not use connected services or personal data.`;
}

export function collectMetrics(run, snapshot, progress, actions, health, now = Date.now()) {
  const day = snapshot.costs.dayStartedAt;
  const days = { ...run.days, [day]: snapshot.costs.selectedBot };
  const versions = [...new Set([...(run.versions ?? []), health.version?.tag].filter(Boolean))];
  const milestones = [
    ...new Map(
      [
        ...(run.milestones ?? []),
        ...(progress?.milestones ?? []).map((item) => ({
          id: item.id,
          state: item.state,
          at: item.created_at
        }))
      ].map((item) => [item.id, item])
    ).values()
  ];
  const file = snapshot.files.find((item) => item.name === `hqbot-${run.mode}.txt`);
  const recovery = snapshot.files.find((item) => item.name === "hqbot-recovery.txt");
  const elapsedHours = (now - Date.parse(run.startedAt)) / 3_600_000;
  const observedHours = new Set(
    milestones
      .filter((item) => item.state !== "verified")
      .map((item) => Math.floor((Date.parse(item.at) - Date.parse(run.startedAt)) / 3_600_000))
      .filter((hour) => hour >= 0 && hour < run.hours)
  ).size;
  const verified =
    progress?.work?.state === "done" &&
    progress.milestones.some((item) => item.state === "verified");
  const remoteApplied = actions.some(
    (item) => item.connector !== "computer" && item.state === "applied"
  );
  const total = (key) => Object.values(days).reduce((sum, value) => sum + (value[key] ?? 0), 0);
  let status = "running";
  if (["failed", "cancelled", "uncertain"].includes(progress?.work?.state)) status = "failed";
  else if (run.mode === "soak" && verified && elapsedHours < run.hours)
    status = "failed_early_completion";
  else if (run.mode === "soak" && verified && observedHours < run.hours)
    status = "failed_missing_hourly_milestones";
  else if (verified && file && (run.mode === "soak" || remoteApplied)) {
    status =
      run.mode === "smoke" &&
      (!recovery ||
        !run.restoredAt ||
        Date.parse(progress.work.createdAt) < Date.parse(run.restoredAt))
        ? "awaiting_recovery_test"
        : "passed";
  } else if (
    progress?.work?.state === "needs_user" ||
    snapshot.selectedBot?.status === "needs_approval"
  )
    status = "needs_owner";
  return {
    ...run,
    days,
    versions,
    milestones,
    status,
    checkedAt: new Date(now).toISOString(),
    metrics: {
      elapsedHours,
      estimatedUsd: total("estimatedUsd"),
      inputTokens: total("inputUnits"),
      outputTokens: total("outputUnits"),
      unpricedRequests: total("unpricedRequests"),
      pendingRequests: total("pendingRequests"),
      savedFileId: file?.id ?? null,
      recoveryFileId: recovery?.id ?? null,
      remoteApplied,
      generation: progress?.work?.generation ?? null,
      workState: progress?.work?.state ?? null,
      milestoneCount: milestones.length,
      observedHours,
      completionVerified: verified
    }
  };
}

async function client() {
  const base = new URL(process.env.HQBOT_EVAL_URL ?? "https://hqbot.edgenode.workers.dev");
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname))
    throw new Error("Use an HTTPS workspace URL");
  const username = process.env.HQBOT_EVAL_USERNAME;
  const password = process.env.HQBOT_EVAL_PASSWORD;
  if (!username || !password)
    throw new Error("Set HQBOT_EVAL_USERNAME and HQBOT_EVAL_PASSWORD in the environment");
  const response = await fetch(new URL("/api/auth/login", base), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base.origin },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) throw new Error(`Owner sign-in failed (HTTP ${response.status})`);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  if (!cookie) throw new Error("Owner sign-in returned no session");
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(new URL(path, base), {
      method,
      headers: { Cookie: cookie, Origin: base.origin, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180_000)
    });
    if (!response.ok) throw new Error(`Evaluation request failed (HTTP ${response.status})`);
    return response.json();
  };
}

async function main() {
  const [command, path, mode = "smoke", duration = "24"] = process.argv.slice(2);
  if (!path || !["prepare", "start", "check", "recover", "stop"].includes(command))
    throw new Error(
      "Usage: node scripts/evaluate.mjs prepare|start|check|recover|stop STATE_FILE [smoke|soak] [24..72]"
    );
  const api = await client();
  let run;
  if (command === "prepare") {
    if (!["smoke", "soak"].includes(mode)) throw new Error("Choose smoke or soak");
    const hours = mode === "soak" ? Number(duration) : 0;
    if (mode === "soak" && (!Number.isInteger(hours) || hours < 24 || hours > 72))
      throw new Error("Soak duration must be 24 to 72 whole hours");
    // Reserve the result path before creating any resources. Never overwrite another run.
    await writeFile(path, "{}\n", { flag: "wx", mode: 0o600 });
    const { teammate } = await api("/api/bots", {
      brief: `HQBot ${mode} acceptance test`,
      conversation: true
    });
    await api(`/api/bots/${teammate.id}`, { name: `HQBot ${mode} test` }, "PATCH");
    run = {
      id: randomUUID(),
      botId: teammate.id,
      mode,
      hours,
      status: "prepared",
      days: {},
      versions: [],
      milestones: []
    };
  } else {
    run = JSON.parse(await readFile(path, "utf8"));
    if (!run.botId || !run.id) throw new Error("The state file has no prepared test");
    const root = `/api/bots/${run.botId}`;
    if (command === "start") {
      if (run.startedAt) throw new Error("This test has already started; use check");
      run.startedAt = new Date().toISOString();
      run.endAt = new Date(Date.now() + run.hours * 3_600_000).toISOString();
      run.status = "running";
      // Persist identity and fixed deadline before submission so recovery cannot reset the timer.
      await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
      await api(`${root}/messages/initial`, { prompt: evaluationPrompt(run) });
    } else if (command === "check") {
      if (!run.startedAt) throw new Error("Start this test first");
      const [snapshot, progress, history, health] = await Promise.all([
        api(`/api/snapshot?botId=${encodeURIComponent(run.botId)}`),
        api(`${root}/task-progress`),
        api(`${root}/actions`),
        api("/health")
      ]);
      run = collectMetrics(run, snapshot, progress, history.actions, health);
    } else if (command === "recover") {
      if (run.mode !== "smoke" || run.status !== "awaiting_recovery_test")
        throw new Error("First check a completed smoke test");
      await api(`${root}/backups`, { action: "save" });
      const { backups } = await api(`${root}/backups`);
      if (!backups[0]) throw new Error("No saved backup is available");
      await api(`${root}/backups`, { action: "restore", id: backups[0].id });
      run.restoredAt = new Date().toISOString();
      const { routine } = await api(`${root}/routines`, {
        name: "HQBot recovery test",
        intervalMinutes: 43200,
        prompt: `Verify computer recovery in this dedicated test. Read /workspace/hqbot/hqbot-smoke.txt after the owner restored its backup. Check the marker ${run.id}. Save criteria for artifactName=hqbot-recovery.txt, then write and upload that file with the checked marker and UTC time. Use manage_task done with evidence. Request approval for each required computer action. Do not use connected services.`
      });
      try {
        await api(`${root}/routines/${routine.id}/run`, {});
      } finally {
        await api(`${root}/routines/${routine.id}`, undefined, "DELETE");
      }
      run.status = "running";
    } else {
      await api(`${root}/task/stop`, {});
      run.status = "stopped";
    }
  }
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `${JSON.stringify({ status: run.status, botId: run.botId, metrics: run.metrics ?? null })}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
