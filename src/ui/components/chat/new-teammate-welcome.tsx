import { PiRobot } from "react-icons/pi";

import { Spinner } from "../ui/spinner";

export function NewTeammateWelcome({
  creating = false,
  error = ""
}: {
  creating?: boolean;
  error?: string;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-5 flex size-11 items-center justify-center rounded-xl border border-divider bg-reader shadow-sm">
        {creating ? <Spinner className="size-5" /> : <PiRobot className="size-5" />}
      </span>
      <p className="text-xs font-medium text-tertiary">
        {creating ? "New teammate" : "No teammate selected"}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
        {creating ? "Creating your teammate" : "Create a teammate"}
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
        {creating
          ? "Its settings and conversation will appear here when it is ready."
          : "Choose New teammate in the sidebar to set it up before you start a conversation."}
      </p>
      {error ? <p className="mt-4 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
