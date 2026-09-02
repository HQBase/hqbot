interface ScreenshotModelOutput {
  data: string;
  description: string;
  filename: string;
  mediaType: "image/jpeg" | "image/png";
}

function isBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/u.test(value);
}

export function screenshotModelOutput(output: ScreenshotModelOutput) {
  if (!isBase64(output.data)) {
    return {
      type: "text" as const,
      value: `${output.description} The image is no longer in recent model context. Capture a new screenshot to inspect it again.`
    };
  }

  return {
    type: "content" as const,
    value: [
      { type: "text" as const, text: output.description },
      {
        type: "file" as const,
        filename: output.filename,
        mediaType: output.mediaType,
        data: { type: "data" as const, data: output.data }
      }
    ]
  };
}
