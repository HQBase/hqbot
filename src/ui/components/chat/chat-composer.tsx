import { type ChangeEvent, type FormEvent, type KeyboardEvent, useRef } from "react";
import { PiArrowUp, PiLink, PiPaperclip, PiStop, PiX } from "react-icons/pi";

import type { BotTeammate } from "../../../domain/types";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

export type ComposerFile = { id: string; name: string };

export function ChatComposer({
  attachedFiles,
  bot,
  error,
  prompt,
  sending,
  uploading,
  working,
  onConnect,
  onPromptChange,
  onRemoveFile,
  onSend,
  onStop,
  onUpload
}: {
  attachedFiles: ComposerFile[];
  bot: BotTeammate | null;
  error: string;
  prompt: string;
  sending: boolean;
  uploading: boolean;
  working: boolean;
  onConnect: () => void;
  onPromptChange: (value: string) => void;
  onRemoveFile: (file: ComposerFile) => void;
  onSend: () => void;
  onStop: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const hasPrompt = Boolean(prompt.trim());
  const stopsWork = working && !hasPrompt;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (hasPrompt && !sending) onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (prompt.trim() && !sending) onSend();
  }

  return (
    <form
      className="mx-auto w-full max-w-[780px] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8 sm:pb-5"
      onSubmit={submit}
    >
      <div className="overflow-hidden rounded-2xl border border-input bg-background/95 shadow-lg backdrop-blur">
        {error ? (
          <p
            className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {attachedFiles.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto px-3 pt-3">
            {attachedFiles.map((file) => (
              <span
                className="flex max-w-52 items-center gap-1 rounded-md border bg-muted px-2 py-1 text-[11px]"
                key={file.id}
              >
                <span className="truncate">{file.name}</span>
                <button
                  aria-label={`Remove ${file.name}`}
                  className="text-muted-foreground hover:text-foreground"
                  type="button"
                  onClick={() => onRemoveFile(file)}
                >
                  <PiX />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <Textarea
          aria-label={bot ? `Message ${bot.name}` : "Message your new teammate"}
          className="min-h-[72px] resize-none rounded-none border-0 bg-transparent px-4 pb-1 pt-3 shadow-none focus-visible:border-0"
          placeholder={bot ? `Message ${bot.name}…` : "Message your new teammate…"}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
          <div className="flex items-center gap-1">
            {bot ? (
              <>
                <input
                  className="hidden"
                  multiple
                  ref={fileInput}
                  type="file"
                  onChange={onUpload}
                />
                <Button
                  aria-label="Attach file"
                  disabled={uploading || attachedFiles.length >= 5}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? <Spinner /> : <PiPaperclip />}
                </Button>
                <Button
                  aria-label="Connect a tool"
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={onConnect}
                >
                  <PiLink />
                </Button>
              </>
            ) : (
              <span className="px-2 text-[11px] text-muted-foreground">
                Creates a teammate and starts the chat
              </span>
            )}
          </div>
          <Button
            aria-label={stopsWork ? "Stop" : "Send"}
            className="relative"
            disabled={stopsWork ? false : !hasPrompt || sending}
            size="icon"
            type={stopsWork ? "button" : "submit"}
            onClick={stopsWork ? onStop : undefined}
          >
            {stopsWork ? (
              <PiStop />
            ) : working ? (
              <span className="relative flex size-5 items-center justify-center">
                <span
                  aria-hidden="true"
                  className="absolute inset-0 animate-spin rounded-full border border-current border-t-transparent motion-reduce:animate-none"
                  data-slot="working-send-ring"
                />
                <PiArrowUp className="!size-3" />
              </span>
            ) : sending ? (
              <Spinner />
            ) : (
              <PiArrowUp />
            )}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] text-tertiary">
        {working
          ? hasPrompt
            ? "Send to redirect the current work"
            : "Type a follow-up or stop the current work"
          : "Enter to send · Shift Enter for a new line"}
      </p>
    </form>
  );
}
