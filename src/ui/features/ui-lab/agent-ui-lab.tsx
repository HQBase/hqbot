import { useState } from "react";
import { PiDeviceMobile, PiFlask, PiMoon, PiSun } from "react-icons/pi";

import type { BotTeammate } from "../../../domain/types";
import { CostPanel } from "../../components/details/cost-panel";
import { TeammateSidebar } from "../../components/teammate-sidebar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useTheme } from "../theme/theme-provider";
import { labArchivedBots, labBots, labCosts } from "./fixtures";
import { type ConversationState, LabConversation, StreamingConversation } from "./lab-conversation";

type LabState = "error" | "mobile" | "reconnecting" | "shell" | "streaming";

const states: { label: string; value: LabState }[] = [
  { label: "Shell", value: "shell" },
  { label: "Streaming", value: "streaming" },
  { label: "Reconnecting", value: "reconnecting" },
  { label: "Error", value: "error" },
  { label: "Mobile", value: "mobile" }
];

export function AgentUiLab() {
  const [state, setState] = useState<LabState>("shell");
  const { setTheme, theme } = useTheme();
  return (
    <main className="min-h-screen bg-rail text-foreground">
      <header className="sticky top-0 z-40 border-b border-divider bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <PiFlask />
            </span>
            <div>
              <p className="text-sm font-semibold">HQBot UI lab</p>
              <p className="text-xs text-muted-foreground">Fixed states. No network or credits.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="hidden sm:inline-flex" variant="outline">
              Development only
            </Badge>
            <Button
              aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
              size="icon"
              type="button"
              variant="outline"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <PiSun /> : <PiMoon />}
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        <div className="mb-4 flex items-center justify-between gap-3 overflow-x-auto">
          <Tabs value={state} onValueChange={(value) => setState(value as LabState)}>
            <TabsList aria-label="Preview state">
              {states.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <p className="hidden text-xs text-muted-foreground md:block">
            Uses the real HQBot components and HQBase design tokens.
          </p>
        </div>
        <LabPreview state={state} />
      </div>
    </main>
  );
}

function LabPreview({ state }: { state: LabState }) {
  if (state === "mobile") {
    return (
      <section aria-label="Mobile frame" className="mx-auto w-full max-w-[390px]">
        <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <PiDeviceMobile /> 390 × 720
        </div>
        <div className="h-[720px] overflow-hidden rounded-[28px] border border-divider bg-reader shadow-xl">
          <LabConversation bot={labBots[0]} mode="live" showBack />
        </div>
      </section>
    );
  }
  return <DesktopShell state={state} />;
}

function DesktopShell({ state }: { state: Exclude<LabState, "mobile"> }) {
  const [selected, setSelected] = useState<BotTeammate>(labBots[0]);
  const mode: ConversationState =
    state === "reconnecting" ? "reconnecting" : state === "error" ? "error" : "live";
  return (
    <section
      aria-label={`${states.find((item) => item.value === state)?.label} preview`}
      className="grid h-[min(760px,calc(100dvh-9rem))] min-h-[560px] overflow-hidden rounded-[28px] border border-divider bg-background shadow-xl lg:grid-cols-[17rem_minmax(0,1fr)_20rem]"
    >
      <div className="hidden min-h-0 bg-list p-2 lg:flex">
        <TeammateSidebar
          archivedBots={labArchivedBots}
          bots={labBots}
          selectedId={selected.id}
          onCreate={() => undefined}
          onLogout={() => undefined}
          onSelect={setSelected}
        />
      </div>
      {state === "streaming" ? (
        <StreamingConversation bot={selected} />
      ) : (
        <LabConversation bot={selected} mode={mode} />
      )}
      <aside className="hidden min-h-0 overflow-y-auto border-l border-divider bg-sidebar p-3 lg:block">
        <CostPanel
          budgetUsd={selected.dailyBudgetUsd}
          costs={labCosts}
          modelId={selected.modelId}
        />
      </aside>
    </section>
  );
}
