declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: { credentials?: Record<string, string>; shared?: boolean }
    );

    background: string;
    compressionLevel: number;
    focusOnClick: boolean;
    qualityLevel: number;
    scaleViewport: boolean;
    viewOnly: boolean;

    disconnect(): void;
    focus(): void;
  }
}
