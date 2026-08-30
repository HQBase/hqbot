import { useCallback, useState } from "react";
import { PiWarning } from "react-icons/pi";

import { AccessGate } from "./components/access-gate";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Spinner } from "./components/ui/spinner";
import { WorkspaceShell } from "./components/workspace-shell";
import { useWorkspace } from "./hooks/use-workspace";

export function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const openWorkspace = useCallback(() => setAuthenticated(true), []);
  const closeWorkspace = useCallback(() => setAuthenticated(false), []);
  if (!authenticated) return <AccessGate onAuthenticated={openWorkspace} />;
  return <AuthenticatedWorkspace onSignedOut={closeWorkspace} />;
}

function AuthenticatedWorkspace({ onSignedOut }: { onSignedOut: () => void }) {
  const controller = useWorkspace(onSignedOut);
  if (controller.snapshot) return <WorkspaceShell controller={controller} />;
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-rail p-4">
      {controller.error ? (
        <Alert className="max-w-md" variant="destructive">
          <PiWarning />
          <AlertTitle>HQBot could not open</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{controller.error}</span>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void controller.load(null)}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Spinner /> Waking your teammates…
        </div>
      )}
    </main>
  );
}
