import { PiCoin } from "react-icons/pi";

import type { CostSnapshot } from "../../../domain/types";
import { currency } from "../../lib/format";
import { Progress } from "../ui/progress";
import { DetailsSection } from "./details-section";

export function CostPanel({ budgetUsd, costs }: { budgetUsd: number; costs: CostSnapshot }) {
  const usage = budgetUsd > 0 ? (costs.selectedBot.estimatedUsd / budgetUsd) * 100 : 0;
  const services = costs.services.selectedBot;
  const resources = costs.platform.resources;
  return (
    <DetailsSection
      badge={`Overall ${currency(costs.overall.estimatedUsd)}`}
      icon={PiCoin}
      id="costs"
      title="Estimated cost"
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          AI and computer estimates with tracked resource counts.
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <CostValue label="Task" value={costs.selectedTask.estimatedUsd} />
          <CostValue label="Teammate" value={costs.selectedBot.estimatedUsd} />
          <CostValue label="Overall" value={costs.overall.estimatedUsd} />
        </div>
        <Progress aria-label="Teammate daily cost budget" value={Math.min(100, usage)} />
        <p className="text-[11px] text-muted-foreground">
          {currency(costs.selectedBot.estimatedUsd)} of {currency(budgetUsd)} daily budget
        </p>
        <ServiceCost
          detail={`${services.workersAi.inputUnits.toLocaleString()} in · ${services.workersAi.outputUnits.toLocaleString()} out`}
          label="Cloudflare AI"
          value={services.workersAi.estimatedUsd}
        />
        <ServiceCost
          detail={`${services.sandbox.inputUnits.toLocaleString()} seconds reserved`}
          label="Computer"
          value={services.sandbox.estimatedUsd}
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
      </div>
    </DetailsSection>
  );
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
