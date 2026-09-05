import { useState } from "react";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { AgentSettingsPanel } from "../details/agent-settings-panel";
import { BackupsPanel } from "../details/backups-panel";
import { ComputerPermissionsPanel } from "../details/computer-permissions-panel";
import { CostPanel } from "../details/cost-panel";
import { DeviceNotifications } from "../inbox/device-notifications";
import { TeamAdministration } from "../team/team-administration";
import { Button } from "../ui/button";
import { NetworkPolicy } from "./network-policy";

export function SettingsPage({ controller }: { controller: WorkspaceController }) {
  const [tab, setTab] = useState("teammate");
  const bot = controller.selectedBot;
  const snapshot = controller.snapshot;
  return (
    <section className="mx-auto max-w-4xl space-y-6 p-5 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage access, costs, and connected devices.
        </p>
      </div>
      <nav aria-label="Settings" className="flex flex-wrap gap-2 border-b pb-3">
        {[
          { id: "teammate", name: "Teammate" },
          { id: "people", name: "People" },
          { id: "network", name: "Network" },
          { id: "devices", name: "Devices" }
        ].map((item) => (
          <Button
            key={item.id}
            variant={tab === item.id ? "secondary" : "ghost"}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.name}
          </Button>
        ))}
      </nav>
      {tab === "people" ? (
        <TeamAdministration user={{ id: "owner", username: "Owner", role: "owner" }} />
      ) : tab === "network" ? (
        <NetworkPolicy />
      ) : tab === "devices" ? (
        <div className="space-y-5">
          <DeviceNotifications />
          <section className="space-y-2 rounded-xl border p-4">
            <h2 className="font-semibold">Install HQBot</h2>
            <p className="text-sm text-muted-foreground">
              Use your browser's Install app or Add to Home Screen action. Your teammates continue
              working when the app is closed.
            </p>
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <select
            aria-label="Settings teammate"
            className="h-10 max-w-full rounded-md border bg-background px-3 text-sm"
            value={bot?.id ?? ""}
            onChange={(event) => {
              const selected = snapshot?.bots.find((item) => item.id === event.target.value);
              if (selected) controller.selectBot(selected);
            }}
          >
            {snapshot?.bots.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {bot && snapshot ? (
            <div className="rounded-xl border px-4">
              <AgentSettingsPanel
                bot={bot}
                onDeleted={() => controller.deleteSelectedBot()}
                onMaxStepsChange={controller.setMaxSteps}
                onModelChange={controller.setModel}
                onSaved={controller.load}
              />
              <ComputerPermissionsPanel
                botId={bot.id}
                needsApproval={bot.status === "needs_approval"}
              />
              <BackupsPanel botId={bot.id} />
              <CostPanel budgetUsd={bot.dailyBudgetUsd} costs={snapshot.costs} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Create a teammate to set its budget and permissions.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
