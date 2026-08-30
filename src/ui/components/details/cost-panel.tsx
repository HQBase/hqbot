import { PiCoin } from "react-icons/pi";

import type { CostSnapshot } from "../../../domain/types";
import { currency } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Progress } from "../ui/progress";

export function CostPanel({
  budgetUsd,
  costs,
  modelId
}: {
  budgetUsd: number;
  costs: CostSnapshot;
  modelId?: string | null;
}) {
  const usage = budgetUsd > 0 ? (costs.selectedBot.estimatedUsd / budgetUsd) * 100 : 0;
  const services = costs.services.selectedBot;
  const resources = costs.platform.resources;
  return (
    <Card className="scroll-mt-3 shadow-none" id="costs">
      <CardHeader className="flex-row items-start justify-between gap-3 p-4 pb-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <PiCoin /> Estimated cost
          </CardTitle>
          <CardDescription className="text-xs">
            AI and browser estimates with tracked resource counts.
          </CardDescription>
        </div>
        <Badge variant="outline">Live</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4 pt-0">
        <div className="grid grid-cols-3 gap-2 text-center">
          <CostValue label="Task" value={costs.selectedTask.estimatedUsd} />
          <CostValue label="Teammate" value={costs.selectedBot.estimatedUsd} />
          <CostValue label="Overall" value={costs.overall.estimatedUsd} />
        </div>
        <Progress aria-label="Teammate daily cost budget" value={Math.min(100, usage)} />
        <p className="text-[11px] text-muted-foreground">
          {currency(costs.selectedBot.estimatedUsd)} of {currency(budgetUsd)} daily budget
        </p>
        <div className="flex items-center justify-between gap-3 border-t border-divider pt-2 text-[11px] text-muted-foreground">
          <span>AI tokens</span>
          {modelId ? <span className="truncate">{modelName(modelId)}</span> : null}
        </div>
        <ServiceCost
          detail={`${services.workersAi.inputUnits.toLocaleString()} in · ${services.workersAi.outputUnits.toLocaleString()} out`}
          label="Workers AI"
          value={services.workersAi.estimatedUsd}
        />
        <ServiceCost
          detail={`${services.browser.inputUnits.toLocaleString()} seconds`}
          label="Browser"
          value={services.browser.estimatedUsd}
        />
        <div className="border-t border-divider pt-3 text-[11px]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <strong className="font-medium text-foreground">Raw Cloudflare footprint</strong>
            <span className="text-muted-foreground">Tracked, not billing</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1.5">
            <span />
            <span className="text-right text-muted-foreground">Teammate</span>
            <span className="text-right text-muted-foreground">Overall</span>
            <FootprintRow
              label="Durable Objects"
              overall={resources.overall.durableObjects.toLocaleString()}
              selected={resources.selectedBot.durableObjects.toLocaleString()}
            />
            <FootprintRow
              label="Agent schedules"
              overall={resources.overall.agentSchedules.toLocaleString()}
              selected={resources.selectedBot.agentSchedules.toLocaleString()}
            />
            <FootprintRow
              label="Tasks today"
              overall={resources.overall.taskSubmissionsToday.toLocaleString()}
              selected={resources.selectedBot.taskSubmissionsToday.toLocaleString()}
            />
            <FootprintRow
              label="Tracked R2 files"
              overall={formatFiles(resources.overall.r2FileObjects, resources.overall.r2FileBytes)}
              selected={formatFiles(
                resources.selectedBot.r2FileObjects,
                resources.selectedBot.r2FileBytes
              )}
            />
          </div>
        </div>
        {costs.platform.selectedBotHqbaseRealtime ? (
          <div className="flex items-start justify-between gap-3 border-t border-divider pt-3 text-[11px]">
            <span>
              <strong className="block font-medium text-foreground">HQBase realtime</strong>
              <span className="text-muted-foreground">
                {costs.platform.hqbaseRealtimeConnections.toLocaleString()} shared connection
                {costs.platform.hqbaseRealtimeConnections === 1 ? "" : "s"}
              </span>
            </span>
            <span className="text-right">
              <strong className="block font-medium tabular-nums text-foreground">
                {formatGbSeconds(costs.platform.durableObjectGbSecondsPerDay)} GB-s/day
              </strong>
              <span className="text-muted-foreground">Raw usage before account allowances</span>
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function modelName(modelId: string): string {
  if (modelId.includes("glm-5.3-flash")) return "GLM 5.3 Flash";
  if (modelId.includes("deepseek") && modelId.includes("flash")) return "DeepSeek Flash";
  return modelId.split("/").at(-1) ?? modelId;
}

function CostValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted px-2 py-2">
      <strong className="block text-sm tabular-nums">{currency(value)}</strong>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function ServiceCost({ detail, label, value }: { detail: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span>
        <strong className="font-medium text-foreground">{label}</strong>
        <span className="ml-1 text-muted-foreground">· {detail}</span>
      </span>
      <strong className="font-medium tabular-nums">{currency(value)}</strong>
    </div>
  );
}

function FootprintRow({
  label,
  overall,
  selected
}: {
  label: string;
  overall: string;
  selected: string;
}) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <strong className="text-right font-medium tabular-nums">{selected}</strong>
      <strong className="text-right font-medium tabular-nums">{overall}</strong>
    </>
  );
}

function formatFiles(objects: number, bytes: number): string {
  return `${objects.toLocaleString()} · ${formatBytes(bytes)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1_048_576)
    return `${(bytes / 1_024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`;
  return `${(bytes / 1_048_576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
}

function formatGbSeconds(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
