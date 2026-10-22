// What a file is, from its bytes (docs/product/10-l2-newsroom-plan.md §6.2): JPEG, PNG or WebP, and its width and
// height, read from the format's own header (no image library: the bytes are never decoded here). Anything else is
// refused, HEIC and AVIF by name. A picture over 100 megapixels is refused too (plan §4.7).
export type Mime = "image/jpeg" | "image/png" | "image/webp";
export type Picture = { mime: Mime; width: number; height: number };

/** How much of a file the header may take: a JPEG's size marker comes after its EXIF block. */
export const HEADER_BYTES = 2 * 1024 * 1024;
export const MAX_PIXELS = 100_000_000;

export class NotAPicture extends Error {}

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  text.split("").every((c, i) => bytes[at + i] === c.charCodeAt(0));
const be16 = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const be32 = (b: Uint8Array, at: number) =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | (be16(b, at + 2) & 0xffff)) >>> 0;
const le16 = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const le24 = (b: Uint8Array, at: number) => le16(b, at) | ((b[at + 2] ?? 0) << 16);
const le32 = (b: Uint8Array, at: number) => (le24(b, at) | ((b[at + 3] ?? 0) << 24)) >>> 0;

/** The SOFn markers, which carry a frame's size (not DHT C4, JPG C8 or DAC CC). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(b: Uint8Array): { width: number; height: number } {
  let i = 2;
  for (;;) {
    if (i + 4 > b.length) throw new NotAPicture("its size was not found in its first 2 MB");
    if (b[i] !== 0xff) throw new NotAPicture("its JPEG markers are broken");
    let marker = b[i + 1] ?? 0;
    while (marker === 0xff) {
      i += 1; // fill bytes
      marker = b[i + 1] ?? 0;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) throw new NotAPicture("it has no frame before its image data");
    const length = be16(b, i + 2);
    if (length < 2) throw new NotAPicture("its JPEG markers are broken");
    if (SOF.has(marker)) {
      if (i + 9 > b.length) throw new NotAPicture("its size was not found in its first 2 MB");
      return { height: be16(b, i + 5), width: be16(b, i + 7) };
    }
    i += 2 + length;
  }
}

function png(b: Uint8Array): { width: number; height: number } {
  if (b.length < 24 || !ascii(b, 12, "IHDR")) throw new NotAPicture("its PNG header is missing");
  return { width: be32(b, 16), height: be32(b, 20) };
}

function webp(b: Uint8Array): { width: number; height: number } {
  if (b.length < 30) throw new NotAPicture("its WebP header is cut short");
  if (ascii(b, 12, "VP8 ")) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) throw new NotAPicture("its WebP frame is broken");
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, "VP8L")) {
    if (b[20] !== 0x2f) throw new NotAPicture("its WebP frame is broken");
    const bits = le32(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, "VP8X")) return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  throw new NotAPicture("its WebP kind is not known");
}

/** The picture a file's first bytes (up to HEADER_BYTES) say it is; NotAPicture with the reason otherwise. */
export function picture(head: Uint8Array): Picture {
  let found: Picture;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) found = { mime: "image/jpeg", ...jpeg(head) };
  else if (ascii(head, 0, "\x89PNG\r\n\x1a\n")) found = { mime: "image/png", ...png(head) };
  else if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) found = { mime: "image/webp", ...webp(head) };
  else if (
    ascii(head, 4, "ftyp") &&
    /^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(String.fromCharCode(...head.slice(8, 12)))
  ) {
    throw new NotAPicture("it is a HEIC or AVIF picture, which Pageinator does not take yet: save it as JPEG");
  } else throw new NotAPicture("it is not a JPEG, PNG or WebP file");
  if (found.width < 1 || found.height < 1) throw new NotAPicture("it says it has no width or height");
  if (found.width * found.height > MAX_PIXELS) throw new NotAPicture("it is larger than 100 megapixels");
  return found;
}

/** The file name's extension for a type, for downloads. */
export const EXTENSION: Record<Mime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
