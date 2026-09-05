import { useCallback, useEffect, useState } from "react";
import { PiArrowLeft, PiCalendar, PiPlus, PiTrash } from "react-icons/pi";
import { type Automation, routineScheduleLabel } from "../../../domain/automations";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { api, errorMessage } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { AutomationEditor } from "./automation-editor";
import { EventTriggers } from "./event-triggers";
import { RoutineRuns } from "./routine-runs";

export function AutomationsPage({
  controller,
  onConversation
}: {
  controller: WorkspaceController;
  onConversation: () => void;
}) {
  const [items, setItems] = useState<Automation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<Automation | "new" | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const bots = controller.snapshot?.bots ?? [];
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await api<{ routines: Automation[] }>("/api/automations", { signal });
      if (!signal?.aborted) {
        setItems(result.routines);
        setError("");
      }
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause, "Routines could not load"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const routine = items.find((item) => item.id === selected);
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-5 py-8 sm:px-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {routine && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="All routines"
              onClick={() => setSelected(null)}
            >
              <PiArrowLeft />
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {routine?.name ?? "Automations"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {routine
                ? routineScheduleLabel(routine.schedule)
                : "Useful work, on time and in one place."}
            </p>
          </div>
        </div>
        <Button disabled={!bots.length} onClick={() => setEditor(routine ?? "new")}>
          {routine ? (
            "Edit routine"
          ) : (
            <>
              <PiPlus /> New routine
            </>
          )}
        </Button>
      </header>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {routine ? (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
            <Badge variant="secondary">{routine.active ? "Enabled" : "Paused"}</Badge>
            <span className="text-sm text-muted-foreground">
              {bots.find((bot) => bot.id === routine.botId)?.name ?? "Archived teammate"}
            </span>
            <Button
              className="ml-auto"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await api(`/api/bots/${routine.botId}/routines/${routine.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ active: !routine.active })
                  });
                  await load();
                } catch (cause) {
                  setError(errorMessage(cause, "The routine could not change"));
                } finally {
                  setPending(false);
                }
              }}
            >
              {routine.active ? "Pause" : "Resume"}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Delete routine"
              disabled={pending}
              onClick={async () => {
                if (!window.confirm("Delete this routine and its run history?")) return;
                setPending(true);
                try {
                  await api(`/api/bots/${routine.botId}/routines/${routine.id}`, {
                    method: "DELETE"
                  });
                  setSelected(null);
                  await load();
                  await controller.load();
                } catch (cause) {
                  setError(errorMessage(cause, "The routine could not be deleted"));
                } finally {
                  setPending(false);
                }
              }}
            >
              <PiTrash />
            </Button>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6">{routine.prompt}</p>
          {routine.schedule.kind === "event" && (
            <EventTriggers key={routine.id} routine={routine} />
          )}
          <RoutineRuns
            key={routine.id}
            routine={routine}
            onOpenConversation={() => {
              const bot = bots.find((bot) => bot.id === routine.botId);
              if (bot) {
                controller.selectBot(bot);
                onConversation();
              }
            }}
          />
        </>
      ) : loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading routines…
        </p>
      ) : !items.length ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <PiCalendar className="size-8 text-muted-foreground" />
          <h2 className="font-medium">Make room for the work that repeats</h2>
          <p className="max-w-md px-5 text-sm text-muted-foreground">
            Set up a daily brief, a weekly review, or a response to an incoming event.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              className="flex flex-col gap-3 rounded-xl border bg-card p-5 text-left hover:bg-accent"
            >
              <div className="flex w-full items-center gap-3">
                <PiCalendar />
                <h2 className="font-medium">{item.name}</h2>
                <Badge className="ml-auto" variant="secondary">
                  {item.active ? "On" : "Paused"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{routineScheduleLabel(item.schedule)}</p>
              <p className="mt-auto text-xs text-muted-foreground">
                {bots.find((bot) => bot.id === item.botId)?.name ?? "Archived teammate"}
              </p>
            </button>
          ))}
        </div>
      )}
      {editor && (
        <AutomationEditor
          key={editor === "new" ? "new" : editor.id}
          routine={editor === "new" ? undefined : editor}
          bots={bots}
          initialBotId={controller.selectedBot?.id}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            await load();
            await controller.load();
          }}
        />
      )}
    </section>
  );
}
