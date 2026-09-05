import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

// Code-owned app mark. Regenerate the PNGs with: node scripts/create-icons.mjs
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, body, tail]);
}
function rounded(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}
for (const size of [192, 512]) {
  const pixels = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = x / size;
      const sy = y / size;
      let color = [24, 33, 24];
      if (
        rounded(sx, sy, 0.22, 0.25, 0.78, 0.71, 0.09) ||
        (sx >= 0.29 && sx < 0.44 && sy >= 0.65 && sy < 0.8 - (sx - 0.29))
      )
        color = [244, 249, 241];
      if (
        rounded(sx, sy, 0.31, 0.36, 0.62, 0.4, 0.02) ||
        rounded(sx, sy, 0.31, 0.46, 0.58, 0.5, 0.02)
      )
        color = [24, 33, 24];
      if ((sx - 0.69) ** 2 + (sy - 0.65) ** 2 < 0.11 ** 2) color = [24, 33, 24];
      if ((sx - 0.69) ** 2 + (sy - 0.65) ** 2 < 0.072 ** 2) color = [159, 215, 116];
      const index = y * (size * 3 + 1) + 1 + x * 3;
      pixels.set(color, index);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0))
  ]);
  await writeFile(new URL(`../public/icon-${size}.png`, import.meta.url), png);
}
