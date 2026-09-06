import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationAttentionItem } from "../../../domain/attention";
import { api, errorMessage } from "../../lib/api";
import { DesktopView } from "../details/desktop-view";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { Spinner } from "../ui/spinner";
import { ApprovalCard } from "./approval-card";

export function ConversationAttention({
  botId,
  onCount
}: {
  botId: string;
  onCount?: (count: number) => void;
}) {
  const [items, setItems] = useState<ConversationAttentionItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const endpoint = `/api/bots/${encodeURIComponent(botId)}/attention`;
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const version = generation.current;
    try {
      const result = await api<{ items: ConversationAttentionItem[] }>(endpoint);
      if (version !== generation.current) return;
      setItems(result.items);
      onCount?.(
        result.items.reduce(
          (sum, item) =>
            sum +
            item.computerApprovals.length +
            item.integrationApprovals.length +
            Number(Boolean(item.handoff)),
          0
        )
      );
      setError("");
    } catch (cause) {
      if (version === generation.current)
        setError(errorMessage(cause, "Action requests could not load"));
    } finally {
      if (version === generation.current) pending.current = false;
    }
  }, [endpoint, onCount]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      generation.current++;
      pending.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  async function decide(key: string, body: unknown) {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, "The decision could not be saved"));
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {items.map((item) => (
        <OwnerActionCards
          key={item.botId}
          item={item}
          disabled={Boolean(busy || error || item.error)}
          busy={busy}
          decide={decide}
        />
      ))}
    </>
  );
}

export function OwnerActionCards({
  item,
  disabled,
  busy,
  decide
}: {
  item: ConversationAttentionItem;
  disabled: boolean;
  busy: string | null;
  decide: (key: string, body: unknown) => Promise<void>;
}) {
  const handoff = item.handoff;
  const key = `${item.botId}:${handoff?.id}`;
  return (
    <>
      {item.error && (
        <Alert>
          <AlertDescription>
            {item.name}: {item.error}
          </AlertDescription>
        </Alert>
      )}
      {item.computerApprovals.map((approval) => (
        <ApprovalCard
          key={approval.executionId}
          title="Allow this computer action?"
          description={`${item.name} needs your approval for this computer action.`}
          details={JSON.stringify(approval.input, null, 2)}
          disabled={disabled}
          pending={busy === `${item.botId}:${approval.executionId}`}
          onApprove={() =>
            void decide(`${item.botId}:${approval.executionId}`, {
              botId: item.botId,
              kind: "computer",
              id: approval.executionId,
              inputHash: approval.inputHash,
              approved: true
            })
          }
          onDeny={() =>
            void decide(`${item.botId}:${approval.executionId}`, {
              botId: item.botId,
              kind: "computer",
              id: approval.executionId,
              inputHash: approval.inputHash,
              approved: false
            })
          }
        />
      ))}
      {item.integrationApprovals.map((approval) => (
        <ApprovalCard
          key={`${approval.executionId}:${approval.seq}`}
          title="Allow this connected action?"
          description={`${item.name} requested ${approval.method.replaceAll("_", " ")} from ${approval.connectorLabel ?? "a connected service"}.`}
          details={JSON.stringify(approval.args, null, 2)}
          disabled={disabled}
          pending={busy === `${item.botId}:${approval.executionId}`}
          onApprove={() =>
            void decide(`${item.botId}:${approval.executionId}`, {
              botId: item.botId,
              kind: "integration",
              id: approval.executionId,
              seq: approval.seq,
              inputHash: approval.inputHash,
              approved: true
            })
          }
          onDeny={() =>
            void decide(`${item.botId}:${approval.executionId}`, {
              botId: item.botId,
              kind: "integration",
              id: approval.executionId,
              seq: approval.seq,
              inputHash: approval.inputHash,
              approved: false
            })
          }
        />
      ))}
      {handoff && (
        <Card className="min-w-0" aria-label={`Computer handoff from ${item.name}`}>
          <CardHeader>
            <CardTitle>Your turn on the computer</CardTitle>
            <CardDescription>
              {item.name} is waiting for you. Sign in or complete the requested step on the screen
              below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {handoff.ownerControl && handoff.running ? (
              <DesktopView
                botId={item.botId}
                active
                embedded
                continuing={disabled || handoff.state === "resuming"}
                onContinue={() =>
                  void decide(key, { botId: item.botId, id: handoff.id, kind: "continue" })
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {handoff.state === "resuming"
                  ? "Returning control and resuming the task…"
                  : "Reconnect the computer to continue this saved handoff."}
              </p>
            )}
          </CardContent>
          <CardFooter className="flex-wrap justify-end gap-2">
            {!handoff.ownerControl && handoff.state === "pending" && (
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  void decide(key, { botId: item.botId, id: handoff.id, kind: "reconnect" })
                }
              >
                Reconnect computer
              </Button>
            )}
            <Button
              disabled={disabled || handoff.state === "resuming"}
              onClick={() =>
                void decide(key, { botId: item.botId, id: handoff.id, kind: "continue" })
              }
            >
              {busy === key && <Spinner data-icon="inline-start" />}I’m done—continue
            </Button>
          </CardFooter>
        </Card>
      )}
    </>
  );
}
