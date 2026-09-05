import { useState } from "react";
import { PiBell, PiCheckCircle } from "react-icons/pi";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { DeviceNotifications } from "./device-notifications";

export function InboxPage({
  controller,
  onConversation
}: {
  controller: WorkspaceController;
  onConversation: () => void;
}) {
  const [unread, setUnread] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const items = controller.snapshot?.notifications ?? [];
  const visible = items.filter((item) => !unread || !item.readAt);
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 py-8 sm:px-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Replies, results, and decisions that need you.
        </p>
      </header>
      <DeviceNotifications />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={unread ? "secondary" : "ghost"} size="sm" onClick={() => setUnread(true)}>
          Unread
        </Button>
        <Button
          variant={!unread ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setUnread(false)}
        >
          All updates
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={pending || !items.some((item) => !item.readAt)}
          onClick={async () => {
            setPending(true);
            try {
              await Promise.all(
                items
                  .filter((item) => !item.readAt)
                  .map((item) => api(`/api/notifications/${item.id}/read`, { method: "POST" }))
              );
              await controller.load();
            } catch (cause) {
              setError(errorMessage(cause, "Updates could not be marked read"));
            } finally {
              setPending(false);
            }
          }}
        >
          <PiCheckCircle /> Mark all read
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!visible.length ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <PiBell className="size-8 text-muted-foreground" />
          <h2 className="font-medium">{unread ? "You are up to date" : "No updates yet"}</h2>
          <p className="text-sm text-muted-foreground">
            Your teammates will leave their updates here.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center gap-4 p-5 text-left hover:bg-accent"
              onClick={async () => {
                const bot = [
                  ...(controller.snapshot?.bots ?? []),
                  ...(controller.snapshot?.archivedBots ?? [])
                ].find((bot) => bot.id === item.botId);
                try {
                  await api(`/api/notifications/${item.id}/read`, { method: "POST" });
                  await controller.load();
                  if (bot) {
                    controller.selectBot(bot);
                    onConversation();
                  }
                } catch (cause) {
                  setError(errorMessage(cause, "Update could not open"));
                }
              }}
            >
              <span
                className={`size-2 shrink-0 rounded-full ${item.readAt ? "bg-muted" : "bg-primary"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {controller.snapshot?.bots.find((bot) => bot.id === item.botId)?.name ??
                    "Teammate"}{" "}
                  · {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
