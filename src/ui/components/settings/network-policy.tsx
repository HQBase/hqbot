import { useEffect, useState } from "react";
import type { AdminPolicy } from "../../../domain/admin-policy";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Textarea } from "../ui/textarea";

export function NetworkPolicy() {
  const [mode, setMode] = useState<AdminPolicy["mode"]>("standard");
  const [origins, setOrigins] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void api<{ policy: AdminPolicy }>("/api/team/policy", { signal: abort.signal })
      .then(({ policy }) => {
        if (!abort.signal.aborted) {
          setMode(policy.mode);
          setOrigins(policy.origins.join("\n"));
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(errorMessage(cause, "Policy could not load"));
      });
    return () => abort.abort();
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("/api/team/policy", {
        method: "POST",
        body: JSON.stringify({
          mode,
          origins: origins
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean)
        })
      });
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause, "Policy could not be saved"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Agent network access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set the network boundary for all teammates. Scoped action permissions still apply.
        </p>
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="network-mode">Access mode</FieldLabel>
          <select
            id="network-mode"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as AdminPolicy["mode"]);
              setSaved(false);
            }}
          >
            <option value="standard">Standard — use teammate permissions</option>
            <option value="connectors-only">Approved connectors only</option>
          </select>
        </Field>
        {mode === "connectors-only" && (
          <Field>
            <FieldLabel htmlFor="network-origins">Allowed MCP server origins</FieldLabel>
            <Textarea
              id="network-origins"
              rows={5}
              value={origins}
              onChange={(event) => {
                setOrigins(event.target.value);
                setSaved(false);
              }}
              placeholder="https://docs.mcp.cloudflare.com"
            />
            <p className="text-xs text-muted-foreground">
              One exact HTTPS origin per line. An empty list blocks all connected services.
            </p>
          </Field>
        )}
      </FieldGroup>
      {mode === "connectors-only" && (
        <div className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm">
          <p>
            This blocks agent computer, browser, shell, and local commands. It stops active teammate
            work when you save.
          </p>
          <p className="text-muted-foreground">
            Approved remote services can have their own network access. This list controls which MCP
            servers HQBot calls.
          </p>
        </div>
      )}
      <Button disabled={busy || !loaded} onClick={() => void save()}>
        {busy ? "Saving…" : "Save network policy"}
      </Button>
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          Policy saved.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
