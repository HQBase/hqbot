import { useEffect, useRef, useState } from "react";
import { PiRecord, PiStop } from "react-icons/pi";
import type { Demonstration } from "../../../domain/demonstrations";
import { api, errorMessage } from "../../lib/api";
import { DemoRecorder, defaultFrameSelection, type RecordedDemo } from "../../lib/demo-recorder";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export function RecordDemonstration({
  botId,
  onClose,
  onSaved
}: {
  botId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [frames, setFrames] = useState(0);
  const [result, setResult] = useState<RecordedDemo | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const recorder = useRef<DemoRecorder | null>(null);
  const resultRef = useRef<RecordedDemo | null>(null);
  const [id] = useState(() => crypto.randomUUID());
  const uploads = useRef(new Map<string, string>());
  useEffect(
    () => () => {
      recorder.current?.dispose();
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    },
    []
  );
  async function upload(key: string, blob: Blob, name: string) {
    const saved = uploads.current.get(key);
    if (saved) return saved;
    const form = new FormData();
    form.set("file", new File([blob], name, { type: blob.type }));
    const { file } = await api<{ file: { id: string } }>(`/api/bots/${botId}/files`, {
      method: "POST",
      body: form
    });
    uploads.current.set(key, file.id);
    return file.id;
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !starting) {
          if (!recording || window.confirm("Stop and discard this recording?")) onClose();
        }
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Teach with a demonstration</DialogTitle>
          <DialogDescription>
            Record a workflow, choose key frames, and create a draft skill. Nothing uploads until
            you save.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="demo-name">Skill name</FieldLabel>
            <Input
              id="demo-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Prepare the weekly report"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="demo-notes">Goal and notes</FieldLabel>
            <Textarea
              id="demo-notes"
              value={notes}
              maxLength={4000}
              rows={3}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What should the teammate learn? Add inputs, important steps, and how to check the result."
            />
          </Field>
        </FieldGroup>
        {!result && (
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-5">
            <p className="text-sm text-muted-foreground">
              Choose one window or screen. Audio is off. Recording stops at ten minutes or 9 MB.
              Keep passwords and private information out of view.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {recording ? (
                <>
                  <Button variant="destructive" onClick={() => recorder.current?.stop()}>
                    <PiStop /> Stop recording
                  </Button>
                  <Button variant="outline" onClick={() => void recorder.current?.capture()}>
                    Capture key step
                  </Button>
                  <span role="status" className="text-sm">
                    {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {frames}{" "}
                    frames
                  </span>
                </>
              ) : (
                <Button
                  disabled={starting}
                  onClick={async () => {
                    setError("");
                    setStarting(true);
                    recorder.current?.dispose();
                    const capture = new DemoRecorder(
                      (seconds, frames) => {
                        setSeconds(seconds);
                        setFrames(frames);
                      },
                      (value) => {
                        resultRef.current = value;
                        setResult(value);
                        setSelected(defaultFrameSelection(value.frames));
                        setRecording(false);
                      },
                      (message) => {
                        setError(message);
                        setRecording(false);
                      }
                    );
                    recorder.current = capture;
                    try {
                      await capture.start();
                      setRecording(capture.active);
                    } catch (cause) {
                      setError(errorMessage(cause, "Screen capture could not start"));
                    } finally {
                      setStarting(false);
                    }
                  }}
                >
                  <PiRecord />
                  {starting ? "Opening screen picker…" : "Start recording"}
                </Button>
              )}
            </div>
          </div>
        )}
        {result && (
          <>
            <video
              aria-label="Recorded demonstration"
              src={result.url}
              controls
              playsInline
              className="max-h-72 w-full rounded-lg bg-black"
            >
              <track kind="captions" label="No audio" />
            </video>
            <div>
              <h2 className="text-sm font-medium">
                Choose frames for the draft · {selected.length}/12
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The draft uses these frames and your notes. It does not analyze every moment of the
                video. Remove frames with private information before saving.
              </p>
            </div>
            <div className="grid max-h-64 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
              {result.frames.map((frame) => (
                <label
                  key={frame.id}
                  className={`cursor-pointer rounded-lg border p-2 ${selected.includes(frame.id) ? "border-primary bg-primary/5" : ""}`}
                >
                  <img
                    src={frame.url}
                    alt={`Recorded step at ${Math.round(frame.seconds)} seconds`}
                    className="aspect-video w-full rounded object-contain"
                  />
                  <span className="mt-2 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={selected.includes(frame.id)}
                      disabled={!selected.includes(frame.id) && selected.length >= 12}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, frame.id]
                            : selected.filter((id) => id !== frame.id)
                        )
                      }
                    />
                    {Math.round(frame.seconds)} seconds
                  </span>
                </label>
              ))}
            </div>
            <Button
              disabled={pending || !name.trim() || !notes.trim() || !selected.length}
              onClick={async () => {
                setPending(true);
                setError("");
                try {
                  setStatus("Saving recording…");
                  const videoId = await upload(
                    "video",
                    result.video,
                    `${name}.${result.video.type === "video/mp4" ? "mp4" : "webm"}`
                  );
                  const frames = [];
                  for (const frame of result.frames.filter((frame) =>
                    selected.includes(frame.id)
                  )) {
                    setStatus(`Saving frame ${frames.length + 1} of ${selected.length}…`);
                    frames.push({
                      fileId: await upload(
                        frame.id,
                        frame.blob,
                        `step-${Math.round(frame.seconds)}.jpg`
                      ),
                      seconds: frame.seconds
                    });
                  }
                  setStatus("Queueing draft…");
                  await api<{ demonstration: Demonstration }>(`/api/bots/${botId}/demonstrations`, {
                    method: "POST",
                    body: JSON.stringify({ id, name, notes, videoId, frames })
                  });
                  await onSaved();
                  onClose();
                } catch (cause) {
                  setError(
                    errorMessage(
                      cause,
                      "The draft could not be queued. Uploaded source files remain in Files."
                    )
                  );
                } finally {
                  setPending(false);
                  setStatus("");
                }
              }}
            >
              {pending ? "Saving…" : "Save and create draft"}
            </Button>
          </>
        )}
        {status && (
          <p role="status" className="text-sm text-muted-foreground">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
