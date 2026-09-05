import { useEffect, useRef, useState } from "react";
import type { WorkspaceController } from "../hooks/use-workspace";
import { api, errorMessage } from "../lib/api";
export function NotificationInbox({ controller }: { controller: WorkspaceController }) {
  const items = controller.snapshot?.notifications ?? [];
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem("hqbot:task-notifications") === "true"
  );
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (
      seen.current &&
      enabled &&
      "Notification" in window &&
      Notification.permission === "granted" &&
      document.hidden
    ) {
      for (const item of items)
        if (!item.readAt && !seen.current.has(item.id))
          new Notification(item.title, { tag: item.id });
    }
    seen.current = new Set(items.map((item) => item.id));
  }, [items, enabled]);
  async function enable() {
    if (!("Notification" in window)) {
      setError("This browser does not support notifications");
      return;
    }
    const permission = await Notification.requestPermission();
    setEnabled(permission === "granted");
    localStorage.setItem("hqbot:task-notifications", String(permission === "granted"));
  }
  return (
    <div className="relative px-3 py-2 text-xs">
      <button type="button" className="w-full text-left" onClick={() => setOpen(!open)}>
        Notifications
        {items.some((item) => !item.readAt)
          ? ` (${items.filter((item) => !item.readAt).length})`
          : ""}
      </button>
      {open && (
        <div className="absolute bottom-full left-2 right-2 z-50 max-h-80 space-y-2 overflow-auto rounded-lg border border-divider bg-list p-3 shadow-lg">
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            onClick={() => {
              if (enabled) {
                setEnabled(false);
                localStorage.setItem("hqbot:task-notifications", "false");
              } else void enable();
            }}
          >
            {enabled ? "Disable browser notifications" : "Enable browser notifications"}
          </button>
          <p className="text-muted-foreground">
            Browser alerts work while HQBot is open. Saved notifications remain here.
          </p>
          {!items.length && <p>No notifications yet.</p>}
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`block w-full rounded p-2 text-left ${item.readAt ? "opacity-60" : "bg-selected"}`}
              onClick={() => {
                const bot = [
                  ...(controller.snapshot?.bots ?? []),
                  ...(controller.snapshot?.archivedBots ?? [])
                ].find((bot) => bot.id === item.botId);
                if (bot) controller.selectBot(bot);
                void api(`/api/notifications/${item.id}/read`, { method: "POST" }).then(
                  () => controller.load(),
                  (cause) => setError(errorMessage(cause, "Notification could not be marked read"))
                );
                setOpen(false);
              }}
            >
              {item.title}
              <time className="mt-1 block text-muted-foreground">
                {new Date(item.createdAt).toLocaleString()}
              </time>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
