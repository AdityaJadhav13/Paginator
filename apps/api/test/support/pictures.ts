// Fictional pictures made byte by byte for the tests: just the headers picture.ts reads (no real photo, no decoder).
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const text = (t: string) => [...t].map((c) => c.charCodeAt(0));

/** A JPEG whose size marker comes after an EXIF-like block of `padding` bytes; `seed` makes its bytes its own. */
export function jpeg(width: number, height: number, padding = 0, seed = 0): Uint8Array {
  const app1: number[] = [];
  for (let left = padding; left > 0;) {
    const n = Math.min(left, 65_000);
    app1.push(0xff, 0xe1, ...be16(n + 2), ...new Array<number>(n).fill(0x45));
    left -= n;
  }
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...be16(16),
    ...text("JFIF"),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    ...app1,
    0xff,
    0xfe,
    ...be16(6),
    ...be32(seed), // a comment, so that two pictures differ
    0xff,
    0xc0,
    ...be16(17),
    8,
    ...be16(height),
    ...be16(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xda,
    ...be16(8),
    1,
    1,
    0,
    0,
    0x3f,
    0,
    0x12,
    0x34,
    0xff,
    0xd9,
  ]);
}

export function png(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89,
    ...text("PNG\r\n\x1a\n"),
    ...be32(13),
    ...text("IHDR"),
    ...be32(width),
    ...be32(height),
    8,
    2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...be32(0),
    ...text("IEND"),
    0xae,
    0x42,
    0x60,
    0x82,
  ]);
}

export function webp(kind: "VP8 " | "VP8L" | "VP8X", width: number, height: number): Uint8Array {
  let chunk: number[];
  if (kind === "VP8 ") chunk = [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), 0, 0];
  else if (kind === "VP8L") chunk = [0x2f, ...le32((width - 1) | ((height - 1) << 14)), 0, 0, 0, 0, 0];
  else chunk = [0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)];
  const body = [...text("WEBP"), ...text(kind), ...le32(chunk.length), ...chunk];
  return Uint8Array.from([...text("RIFF"), ...le32(body.length), ...body]);
}

export function heic(): Uint8Array {
  return Uint8Array.from([0, 0, 0, 24, ...text("ftypheic"), 0, 0, 0, 0, ...text("mif1heic"), 0, 0, 0, 0]);
}
