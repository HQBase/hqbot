import { type FormEvent, useEffect, useState } from "react";
import { PiCloudCheck, PiLockKey, PiRobot, PiUser } from "react-icons/pi";

import { api, errorMessage } from "../lib/api";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";

type AuthStatus = { authenticated: boolean; configured: boolean };
type AccessMode = "checking" | "create" | "login";

export function AccessGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<AccessMode>("checking");
  const [setupCode, setSetupCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void api<AuthStatus>("/api/auth/status")
      .then((status) => {
        if (!active) return;
        if (status.authenticated) onAuthenticated();
        else setMode(status.configured ? "login" : "create");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(errorMessage(cause, "HQBot could not check access"));
        setMode("login");
      });
    return () => {
      active = false;
    };
  }, [onAuthenticated]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (mode === "create" && password !== confirmation) {
      setError("The passwords do not match");
      return;
    }
    setPending(true);
    setError("");
    try {
      await api(mode === "create" ? "/api/auth/bootstrap" : "/api/auth/login", {
        body: JSON.stringify({
          password,
          setupCode: mode === "create" ? setupCode : undefined,
          username
        }),
        method: "POST"
      });
      onAuthenticated();
    } catch (cause) {
      setError(errorMessage(cause, mode === "create" ? "Owner setup failed" : "Sign-in failed"));
    } finally {
      setPending(false);
    }
  }

  if (mode === "checking") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-rail p-4 text-foreground">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Spinner /> Checking your workspace…
        </div>
      </main>
    );
  }

  const creating = mode === "create";
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-rail p-4 text-foreground">
      <Card className="w-full max-w-md bg-reader">
        <CardHeader className="gap-4">
          <span className="flex size-11 items-center justify-center rounded-xl border border-divider bg-muted">
            <PiRobot className="size-6" />
          </span>
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-xl">
              {creating ? "Create the HQBot owner" : "Welcome back"}
            </CardTitle>
            <CardDescription>
              {creating
                ? "Set the first local account for this Cloudflare installation."
                : "Sign in to your self-hosted workspace."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
            <FieldGroup>
              {creating ? (
                <PasswordField
                  autoComplete="one-time-code"
                  description="Use the private code that you chose during deployment."
                  id="owner-setup-code"
                  label="One-time setup code"
                  value={setupCode}
                  onChange={setSetupCode}
                />
              ) : null}
              <Field>
                <FieldLabel htmlFor="owner-username">Username</FieldLabel>
                <div className="relative">
                  <PiUser className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoComplete="username"
                    className="pl-9"
                    id="owner-username"
                    maxLength={80}
                    required
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </div>
              </Field>
              <PasswordField
                error={error}
                id="owner-password"
                label="Password"
                newPassword={creating}
                value={password}
                onChange={setPassword}
              />
              {creating ? (
                <PasswordField
                  id="owner-password-confirmation"
                  label="Confirm password"
                  newPassword
                  value={confirmation}
                  onChange={setConfirmation}
                />
              ) : null}
            </FieldGroup>
            <Button
              className="w-full"
              disabled={
                pending ||
                !username.trim() ||
                password.length < 12 ||
                (creating && setupCode.length < 24)
              }
              size="field"
              type="submit"
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {pending ? "Please wait…" : creating ? "Create owner" : "Sign in"}
            </Button>
          </form>
          <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
            <PiCloudCheck className="size-4" /> Passwords and sessions stay in your Cloudflare
            account
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function PasswordField({
  autoComplete,
  description,
  error,
  id,
  label,
  newPassword = false,
  value,
  onChange
}: {
  autoComplete?: string;
  description?: string;
  error?: string;
  id: string;
  label: string;
  newPassword?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <PiLockKey className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-invalid={error ? true : undefined}
          autoComplete={autoComplete ?? (newPassword ? "new-password" : "current-password")}
          className="pl-9"
          id={id}
          maxLength={128}
          minLength={id === "owner-setup-code" ? 24 : 12}
          required
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {error && id === "owner-password" ? (
        <FieldError>{error}</FieldError>
      ) : description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : id === "owner-password" ? (
        <FieldDescription>Use at least 12 characters.</FieldDescription>
      ) : null}
    </Field>
  );
}
