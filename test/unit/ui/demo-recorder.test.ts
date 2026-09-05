import { expect, it } from "vitest";
import { defaultFrameSelection, type RecordedFrame } from "../../../src/ui/lib/demo-recorder";

it("selects at most twelve frames across the full recording, including its start and end", () => {
  const frames = Array.from({ length: 61 }, (_, index) => ({
    id: String(index),
    seconds: index * 10
  })) as RecordedFrame[];
  const selected = defaultFrameSelection(frames);
  expect(selected).toHaveLength(12);
  expect(new Set(selected).size).toBe(12);
  expect(selected[0]).toBe("0");
  expect(selected.at(-1)).toBe("60");
  expect(defaultFrameSelection(frames.slice(0, 3))).toEqual(["0", "1", "2"]);
});
