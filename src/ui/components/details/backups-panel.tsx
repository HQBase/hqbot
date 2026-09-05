import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";

interface BackupView {
  backups: { id: string; size: number; createdAt: string }[];
  status: { checkpointError?: string; checkpointAt: string | null };
}
export function BackupsPanel({ botId }: { botId: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<BackupView | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void api<BackupView>(`/api/bots/${botId}/backups?revision=${revision}`, {
      signal: controller.signal
    }).then(
      (result) => {
        if (!controller.signal.aborted) setView(result);
      },
      (cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause, "Backups could not load"));
      }
    );
    return () => controller.abort();
  }, [botId, open, revision]);
  async function save(action: "save" | "restore", id?: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/bots/${botId}/backups`, {
        method: "POST",
        body: JSON.stringify({ action, id })
      });
      setSelected(null);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(errorMessage(cause, "The backup action failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="border-t border-divider py-4 text-xs">
      <button type="button" className="font-medium" onClick={() => setOpen(!open)}>
        Computer backups
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p>
            The latest 10 versions stay in your private storage. Backups include workspace files and
            saved browser sessions. Keep exports private.
          </p>
          {(error || view?.status.checkpointError) && (
            <p role="alert">{error || view?.status.checkpointError}</p>
          )}
          <button type="button" disabled={busy} onClick={() => void save("save")}>
            Save running computer now
          </button>
          {view?.backups.map((backup) => (
            <div key={backup.id} className="space-y-2 rounded border p-2">
              <p>
                {new Date(backup.createdAt).toLocaleString()} ·{" "}
                {Math.ceil(backup.size / 1024).toLocaleString()} KiB
              </p>
              <div className="flex gap-4">
                <a href={`/api/bots/${botId}/backups/${encodeURIComponent(backup.id)}`}>Export</a>
                <button disabled={busy} type="button" onClick={() => setSelected(backup.id)}>
                  Restore
                </button>
              </div>
              {selected === backup.id && (
                <div className="space-y-2">
                  <p>
                    Restore this version? Stop the active task first. HQBot saves the current
                    computer before it replaces files.
                  </p>
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() => void save("restore", backup.id)}
                  >
                    Restore selected version
                  </button>
                  <button type="button" onClick={() => setSelected(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
          {view && !view.backups.length && (
            <p>No versioned backups yet. Start the computer to create one.</p>
          )}
        </div>
      )}
    </section>
  );
}
