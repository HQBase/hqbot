import { PiArrowUp, PiRobot } from "react-icons/pi";

import { Button } from "../ui/button";

export function NewTeammateWelcome({ onSuggestion }: { onSuggestion: (prompt: string) => void }) {
  const suggestions = [
    "Be my inbox manager. Research requests and draft useful replies.",
    "Be my research analyst. Investigate questions and return sourced answers."
  ];
  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-5 flex size-11 items-center justify-center rounded-xl border border-divider bg-reader shadow-sm">
        <PiRobot className="size-5" />
      </span>
      <p className="text-xs font-medium text-tertiary">New teammate</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
        Start a conversation
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
        Send any message. HQBot creates a teammate and answers in this chat.
      </p>
      <div className="mt-7 grid w-full gap-2 sm:grid-cols-2">
        {suggestions.map((suggestion, index) => (
          <Button
            className="h-auto justify-between whitespace-normal p-3 text-left text-xs leading-5"
            key={suggestion}
            type="button"
            variant="outline"
            onClick={() => onSuggestion(suggestion)}
          >
            {index === 0 ? "Inbox manager" : "Research analyst"}
            <PiArrowUp data-icon="inline-end" />
          </Button>
        ))}
      </div>
    </div>
  );
}
