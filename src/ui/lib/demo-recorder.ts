export interface RecordedFrame {
  id: string;
  seconds: number;
  blob: Blob;
  url: string;
}
export interface RecordedDemo {
  video: Blob;
  url: string;
  frames: RecordedFrame[];
  duration: number;
}
export function defaultFrameSelection(frames: RecordedFrame[]): string[] {
  if (frames.length <= 12) return frames.map((frame) => frame.id);
  return Array.from(
    { length: 12 },
    (_, index) => frames[Math.round((index * (frames.length - 1)) / 11)]?.id ?? ""
  );
}
export class DemoRecorder {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = 0;
  private frames: RecordedFrame[] = [];
  private chunks: Blob[] = [];
  private capturing = false;
  private disposed = false;
  constructor(
    private readonly progress: (seconds: number, frames: number) => void,
    private readonly finished: (value: RecordedDemo) => void,
    private readonly failed: (message: string) => void
  ) {}
  async start() {
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined")
      throw new Error("Screen recording is not supported in this browser. Use a desktop browser.");
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 10, max: 15 } },
      audio: false
    });
    if (this.disposed) {
      this.release();
      return;
    }
    try {
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.srcObject = this.stream;
      await this.video.play();
      if (this.disposed) {
        this.release();
        return;
      }
      const mimeType = ["video/webm;codecs=vp8", "video/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type)
      );
      if (!mimeType) throw new Error("This browser cannot record a supported video format");
      const recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 500000 });
      this.recorder = recorder;
      let size = 0;
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          this.chunks.push(event.data);
          size += event.data.size;
          if (size >= 9000000) this.stop();
        }
      };
      recorder.onerror = () => {
        this.failed("The screen recording stopped with an error. Try recording again.");
        this.dispose();
      };
      recorder.onstop = () => {
        void this.finish().catch(() => {
          this.failed("The recording could not be saved. Try again.");
          this.dispose();
        });
      };
      for (const track of this.stream.getVideoTracks())
        track.addEventListener("ended", () => this.stop(), { once: true });
      this.started = Date.now();
      recorder.start(1000);
      this.timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - this.started) / 1000);
        this.progress(seconds, this.frames.length);
        if (seconds >= 600) this.stop();
        else if (seconds % 10 === 0) void this.capture().catch(() => undefined);
      }, 1000);
      await this.capture();
    } catch (cause) {
      this.release();
      throw cause;
    }
  }
  get active() {
    return this.recorder?.state === "recording";
  }
  async capture() {
    if (this.capturing || !this.video?.videoWidth || this.frames.length >= 80 || this.disposed)
      return;
    this.capturing = true;
    try {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(1, 1280 / this.video.videoWidth, 900 / this.video.videoHeight);
      canvas.width = Math.round(this.video.videoWidth * ratio);
      canvas.height = Math.round(this.video.videoHeight * ratio);
      canvas.getContext("2d")?.drawImage(this.video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.65)
      );
      if (!blob || blob.size > 500000 || this.disposed) return;
      this.frames.push({
        id: crypto.randomUUID(),
        seconds: (Date.now() - this.started) / 1000,
        blob,
        url: URL.createObjectURL(blob)
      });
      this.progress(Math.floor((Date.now() - this.started) / 1000), this.frames.length);
    } finally {
      this.capturing = false;
    }
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.recorder?.state === "recording") this.recorder.stop();
  }
  private async finish() {
    if (this.disposed) {
      this.release();
      return;
    }
    await this.capture();
    if (this.disposed) {
      this.release();
      return;
    }
    const video = new Blob(this.chunks, {
      type: this.recorder?.mimeType.split(";", 1)[0] ?? "video/webm"
    });
    this.release();
    if (!video.size || video.size > 10000000 || !this.frames.length) {
      this.failed(
        "The recording has no usable frames or exceeds 10 MB. Record a shorter demonstration."
      );
      this.dispose();
      return;
    }
    this.finished({
      video,
      url: URL.createObjectURL(video),
      frames: this.frames,
      duration: (Date.now() - this.started) / 1000
    });
  }
  private release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }
  dispose() {
    this.disposed = true;
    this.stop();
    this.release();
    for (const frame of this.frames) URL.revokeObjectURL(frame.url);
    this.chunks = [];
  }
}
