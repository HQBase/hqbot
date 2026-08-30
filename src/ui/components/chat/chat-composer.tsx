import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { PiArrowUp, PiLink, PiPaperclip, PiX } from "react-icons/pi";

import type { BotTeammate } from "../../../domain/types";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

export type ComposerFile = { id: string; name: string };

interface MentionQuery {
  end: number;
  query: string;
  start: number;
}

export function mentionQueryAtCaret(value: string, caret: number): MentionQuery | null {
  const prefix = value.slice(0, caret);
  const start = prefix.lastIndexOf("@");
  if (start < 0) return null;
  const before = prefix[start - 1];
  const query = prefix.slice(start + 1);
  if ((before && !/[\s([{]/u.test(before)) || /[\r\n]/u.test(query)) return null;
  return { end: caret, query, start };
}

export function ChatComposer({
  attachedFiles,
  bot,
  error,
  prompt,
  sending,
  teammates,
  uploading,
  onConnect,
  onPromptChange,
  onRemoveFile,
  onSend,
  onUpload
}: {
  attachedFiles: ComposerFile[];
  bot: BotTeammate | null;
  error: string;
  prompt: string;
  sending: boolean;
  teammates: BotTeammate[];
  uploading: boolean;
  onConnect: () => void;
  onPromptChange: (value: string) => void;
  onRemoveFile: (file: ComposerFile) => void;
  onSend: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const listboxId = useId();
  const [caret, setCaret] = useState(prompt.length);
  const [mentionsOpen, setMentionsOpen] = useState(true);
  const [selectedMention, setSelectedMention] = useState(0);
  const mention = bot ? mentionQueryAtCaret(prompt, caret) : null;
  const peers = useMemo(
    () => teammates.filter((teammate) => !teammate.hidden && teammate.id !== bot?.id),
    [bot?.id, teammates]
  );
  const mentionOptions = mention
    ? peers.filter((teammate) =>
        teammate.name.toLocaleLowerCase().startsWith(mention.query.toLocaleLowerCase())
      )
    : [];
  const showMentions = mentionsOpen && mentionOptions.length > 0;
  const activeMention = Math.min(selectedMention, Math.max(mentionOptions.length - 1, 0));

  function submit(event: FormEvent): void {
    event.preventDefault();
    onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (showMentions) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSelectedMention(
          (current) => (current + direction + mentionOptions.length) % mentionOptions.length
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionsOpen(false);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(mentionOptions[activeMention] ?? mentionOptions[0]);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (prompt.trim() && !sending) onSend();
  }

  function insertMention(teammate: BotTeammate | undefined): void {
    if (!mention || !teammate) return;
    const suffix = prompt.slice(mention.end);
    const separator = suffix && /^[\s.,!?;:)\]}]/u.test(suffix) ? "" : " ";
    const inserted = `@${teammate.name}${separator}`;
    const next = `${prompt.slice(0, mention.start)}${inserted}${suffix}`;
    const nextCaret = mention.start + inserted.length;
    onPromptChange(next);
    setCaret(nextCaret);
    setMentionsOpen(false);
    window.requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(nextCaret, nextCaret);
    });
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
          aria-activedescendant={showMentions ? `${listboxId}-option-${activeMention}` : undefined}
          aria-autocomplete="list"
          aria-controls={showMentions ? listboxId : undefined}
          aria-expanded={showMentions}
          aria-label={bot ? `Message ${bot.name}` : "Message your new teammate"}
          className="min-h-[72px] resize-none rounded-none border-0 bg-transparent px-4 pb-1 pt-3 shadow-none focus-visible:border-0"
          placeholder={bot ? `Message ${bot.name}…` : "Message your new teammate…"}
          ref={textarea}
          role="combobox"
          value={prompt}
          onChange={(event) => {
            setCaret(event.target.selectionStart);
            setMentionsOpen(true);
            setSelectedMention(0);
            onPromptChange(event.target.value);
          }}
          onClick={(event) => {
            setCaret(event.currentTarget.selectionStart);
            setMentionsOpen(true);
            setSelectedMention(0);
          }}
          onKeyDown={handleKeyDown}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        />
        {showMentions ? (
          <div className="border-t border-divider px-2 py-1.5">
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-tertiary">
              Ask a teammate
            </p>
            <div
              aria-label="Teammates"
              className="flex gap-1 overflow-x-auto"
              id={listboxId}
              role="listbox"
            >
              {mentionOptions.map((teammate, index) => (
                <button
                  aria-selected={index === activeMention}
                  className="min-w-0 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted aria-selected:bg-selected"
                  id={`${listboxId}-option-${index}`}
                  key={teammate.id}
                  role="option"
                  type="button"
                  onClick={() => insertMention(teammate)}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <span className="block truncate font-medium">@{teammate.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {teammate.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
          <Button aria-label="Send" disabled={!prompt.trim() || sending} size="icon" type="submit">
            {sending ? <Spinner /> : <PiArrowUp />}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] text-tertiary">
        Enter to send · Shift Enter for a new line
        {bot && peers.length > 0 ? " · @Name to ask a teammate" : ""}
      </p>
    </form>
  );
}
