import { useCallback, useEffect, useState } from "react";
import type { LocalDevice, LocalJob } from "../../../domain/local-devices";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";

export function LocalDevices({ bots }: { bots: { id: string; name: string }[] }) {
  const [devices, setDevices] = useState<LocalDevice[]>([]);
  const [jobs, setJobs] = useState<LocalJob[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const data = await api<{ devices: LocalDevice[]; jobs: LocalJob[] }>("/api/local-devices");
    setDevices(data.devices);
    setJobs(data.jobs);
  }, []);
  useEffect(() => {
    const refresh = () =>
      void load().catch((cause) => setError(errorMessage(cause, "Devices could not load")));
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [load]);
  async function change(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Device change failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border p-4">
      <div>
        <h2 className="font-semibold">Local computers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pair the macOS companion to use local files and programs. You review each command in a
          native dialog on that Mac.
        </p>
      </div>
      {devices.map((device) => (
        <div
          key={device.id}
          className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 p-3"
        >
          <div className="min-w-0">
            <p className="font-medium">{device.name}</p>
            <p className="text-xs text-muted-foreground">
              {device.botIds
                .map((id) => bots.find((bot) => bot.id === id)?.name ?? "Teammate")
                .join(", ")}
            </p>
            <p className="text-xs text-muted-foreground">
              {device.lastSeenAt
                ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}`
                : "Waiting for the companion"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void change(() =>
                api(`/api/local-devices/${encodeURIComponent(device.id)}`, { method: "DELETE" })
              )
            }
          >
            Remove
          </Button>
        </div>
      ))}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">Pair a computer</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Choose the teammates that can request local work. Open Local access in the macOS app,
            select a working folder, and enter the code.
          </p>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-2 text-sm font-medium">Teammates</legend>
            {bots.map((bot) => (
              <label key={bot.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(bot.id)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, bot.id]
                        : selected.filter((id) => id !== bot.id)
                    )
                  }
                />
                {bot.name}
              </label>
            ))}
          </fieldset>
          <Button
            disabled={busy || selected.length === 0}
            onClick={() =>
              void change(async () =>
                setPairing(
                  await api("/api/local-devices/pair", {
                    method: "POST",
                    body: JSON.stringify({ botIds: selected })
                  })
                )
              )
            }
          >
            Create pairing code
          </Button>
          {pairing && (
            <div className="space-y-2 rounded-lg bg-muted p-3">
              <label className="block text-sm" htmlFor="pairing-code">
                Pairing code — expires {new Date(pairing.expiresAt).toLocaleTimeString()}
              </label>
              <input
                id="pairing-code"
                readOnly
                value={pairing.code}
                onFocus={(event) => event.target.select()}
                className="w-full rounded border bg-background p-2 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Use this code once. Pairing does not approve a command.
              </p>
            </div>
          )}
        </div>
      </details>
      {jobs.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Recent local work</summary>
          <div className="mt-3 space-y-2">
            {jobs.slice(0, 10).map((job) => (
              <details key={job.id} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm">
                  {bots.find((bot) => bot.id === job.botId)?.name ?? "Teammate"} · {job.state} ·{" "}
                  {new Date(job.createdAt).toLocaleString()}
                </summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">
                  {job.command}
                  {job.result ? `\n\n${job.result}` : ""}
                </pre>
              </details>
            ))}
          </div>
        </details>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
