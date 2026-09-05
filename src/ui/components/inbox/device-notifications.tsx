import { useCallback, useEffect, useRef, useState } from "react";
import type { PushDevice, PushPreferences } from "../../../domain/push";
import { api, errorMessage } from "../../lib/api";
import { disableDevicePush, enableDevicePush, pushDeviceKey } from "../../lib/device-push";
import { Button } from "../ui/button";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";

export function DeviceNotifications() {
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [current, setCurrent] = useState(() => localStorage.getItem(pushDeviceKey));
  const [name, setName] = useState("This browser");
  const [preferences, setPreferences] = useState<PushPreferences>({
    replies: true,
    failures: true,
    input: true
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const testId = useRef<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await api<{ devices: PushDevice[] }>("/api/push/devices", { signal });
      if (!signal?.aborted) {
        setDevices(result.devices);
        const saved = result.devices.find(
          (device) => device.id === localStorage.getItem(pushDeviceKey)
        );
        if (saved) {
          setName(saved.name);
          setPreferences(saved.preferences);
        }
      }
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause, "Devices could not load"));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const enabled = devices.some((device) => device.id === current);
  return (
    <details className="rounded-xl border bg-card p-5">
      <summary className="cursor-pointer font-medium">
        Device notifications{" "}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {enabled ? "On for this device" : "Off for this device"}
        </span>
      </summary>
      <div className="mt-5 flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">
          Get updates while HQBot is closed. Alerts contain a generic status. On iPhone or iPad,
          first add HQBot to your Home Screen.
        </p>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="push-device-name">Device name</FieldLabel>
            <Input
              id="push-device-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["replies", "Replies and completed work"],
                ["failures", "Failures"],
                ["input", "Input and approvals"]
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={preferences[key]}
                  onChange={(event) =>
                    setPreferences({ ...preferences, [key]: event.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </FieldGroup>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending || !name.trim()}
            onClick={async () => {
              setPending(true);
              setError("");
              try {
                const device = await enableDevicePush(name, preferences);
                setCurrent(device.id);
                await load();
                setNotice("Device notifications are enabled.");
              } catch (cause) {
                setError(errorMessage(cause, "Notifications could not be enabled"));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Saving…" : enabled ? "Save preferences" : "Enable on this device"}
          </Button>
          {enabled && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={async () => {
                if (!current) return;
                setPending(true);
                setError("");
                try {
                  testId.current ??= crypto.randomUUID();
                  await api(`/api/push/devices/${current}/test`, {
                    method: "POST",
                    body: JSON.stringify({ id: testId.current })
                  });
                  testId.current = null;
                  setNotice("Test alert queued. It should arrive within one minute.");
                } catch (cause) {
                  setError(errorMessage(cause, "Test alert could not be queued"));
                } finally {
                  setPending(false);
                }
              }}
            >
              Send test alert
            </Button>
          )}
        </div>
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {devices.length > 0 && (
          <div className="flex flex-col gap-3 border-t pt-4">
            <h3 className="text-sm font-medium">Enabled devices</h3>
            {devices.map((device) => (
              <div className="flex items-center justify-between gap-3" key={device.id}>
                <div>
                  <p className="text-sm">
                    {device.name}
                    {device.id === current ? " · this device" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {device.lastStatus ?? "Ready for alerts"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    setError("");
                    try {
                      await disableDevicePush(device.id);
                      if (device.id === current) setCurrent(null);
                      await load();
                    } catch (cause) {
                      setError(errorMessage(cause, "Device could not be removed"));
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  Disable
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
