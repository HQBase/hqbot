import { type FormEvent, useState } from "react";
import { PiLink, PiPlugsConnected, PiShieldCheck } from "react-icons/pi";

import type { BotTeammate } from "../../../domain/types";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

export function ConnectionDialog({
  bot,
  open,
  onChanged,
  onOpenChange
}: {
  bot: BotTeammate;
  open: boolean;
  onChanged: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [origin, setOrigin] = useState("https://");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api(`/api/bots/${bot.id}/connections/hqbase`, {
        method: "POST",
        body: JSON.stringify({ origin, token: credential })
      });
      await onChanged();
      setCredential("");
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, "HQBase could not connect"));
    } finally {
      setPending(false);
    }
  }

  async function disconnect(): Promise<void> {
    setPending(true);
    setError("");
    try {
      await api(`/api/bots/${bot.id}/connections/hqbase`, { method: "DELETE" });
      await onChanged();
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, "HQBase could not disconnect"));
    } finally {
      setPending(false);
    }
  }

  if (bot.connection) {
    const status =
      bot.connection.realtimeStatus === "connected"
        ? "Connected"
        : bot.connection.realtimeStatus === "connecting"
          ? "Connecting"
          : "Reconnecting";

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(92vw,520px)]">
          <DialogHeader>
            <DialogTitle>HQBase connection</DialogTitle>
            <DialogDescription>
              {bot.name} receives new mail from this mailbox in realtime.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <ConnectionRow label="Mailbox" value={bot.connection.mailboxAddress} />
            <ConnectionRow label="HQBase" value={bot.connection.origin} />
            <ConnectionRow label="Status" value={status} />
          </div>
          {error ? <FieldError>{error}</FieldError> : null}
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <PiPlugsConnected /> Disconnecting stops new mail work. It does not delete mail.
          </p>
          <DialogFooter>
            <Button
              disabled={pending}
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              disabled={pending}
              type="button"
              variant="destructive"
              onClick={() => void disconnect()}
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,520px)]">
        <DialogHeader>
          <DialogTitle>Connect HQBase</DialogTitle>
          <DialogDescription>
            Give {bot.name} access to one mailbox. Mail stays in HQBase.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="hqbase-origin">HQBase URL</FieldLabel>
              <Input
                id="hqbase-origin"
                required
                type="url"
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
              />
            </Field>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="hqbase-token">Agent connection credential</FieldLabel>
              <Input
                aria-invalid={error ? true : undefined}
                autoComplete="off"
                id="hqbase-token"
                placeholder="hqb_agent_…"
                required
                type="password"
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
              />
              <FieldDescription>
                Create a mailbox agent with Handle mail access in HQBase.
              </FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <PiShieldCheck /> Encrypted before storage in your Cloudflare account
          </p>
          <DialogFooter>
            <Button
              disabled={pending}
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button disabled={pending || !origin.trim() || !credential.trim()} type="submit">
              {pending ? <Spinner data-icon="inline-start" /> : <PiLink data-icon="inline-start" />}{" "}
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[5rem_1fr] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}
