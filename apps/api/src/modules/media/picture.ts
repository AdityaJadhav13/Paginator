// What a file is, from its bytes (docs/product/10-l2-newsroom-plan.md §6.2): JPEG, PNG or WebP, and its width and
// height, read from the format's own header (no image library: the bytes are never decoded here). Anything else is
// refused, HEIC and AVIF by name. A picture over 100 megapixels (plan §4.7), or with a side over 100000 pixels, is
// refused too.
export type Mime = "image/jpeg" | "image/png" | "image/webp";
export type Picture = { mime: Mime; width: number; height: number };

/** How much of a file the header may take (PNG and WebP name their size at the start; a JPEG is scanned whole). */
export const HEADER_BYTES = 64 * 1024;
export const MAX_PIXELS = 100_000_000;
/** The longest side the database takes (app.asset.width_px and height_px). */
export const MAX_SIDE = 100_000;

export class NotAPicture extends Error {}

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  text.split("").every((c, i) => bytes[at + i] === c.charCodeAt(0));
const be16 = (b: ArrayLike<number>, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const be32 = (b: Uint8Array, at: number) =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | (be16(b, at + 2) & 0xffff)) >>> 0;
const le16 = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const le24 = (b: Uint8Array, at: number) => le16(b, at) | ((b[at + 2] ?? 0) << 16);
const le32 = (b: Uint8Array, at: number) => (le24(b, at) | ((b[at + 3] ?? 0) << 24)) >>> 0;

/** The SOFn markers, which carry a frame's size (not DHT C4, JPG C8 or DAC CC). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** A JPEG's size, found by walking its markers as its bytes arrive, however far into the file the frame comes (the
 * read stops at 40 MiB): a camera's EXIF and maker notes can fill several MB before it. Only the marker being read
 * is kept, at most 9 bytes. */
export class JpegScan {
  private offset = 0; // the file offset of the next byte fed
  private next = 2; // the file offset of the next marker (after the SOI)
  private marker: number[] = []; // the marker being read, from its 0xFF
  private size: { width: number; height: number } | undefined;
  private failure: string | undefined;

  feed(chunk: Uint8Array): void {
    let i = Math.max(0, this.next - this.offset);
    while (i < chunk.length && !this.size && !this.failure) {
      this.step(chunk[i] ?? 0, this.offset + i);
      i = Math.max(i + 1, this.next - this.offset);
    }
    this.offset += chunk.length;
  }

  private step(byte: number, at: number): void {
    const m = this.marker;
    this.next = at + 1;
    if (m.length === 0) {
      if (byte !== 0xff) this.failure = "its JPEG markers are broken";
      else m.push(byte);
      return;
    }
    if (m.length === 1) {
      if (byte === 0xff) return; // fill bytes
      if (byte === 0xd8 || byte === 0x01 || (byte >= 0xd0 && byte <= 0xd7)) {
        this.marker = []; // markers without a length
        return;
      }
      if (byte === 0xd9 || byte === 0xda) {
        this.failure = "it has no frame before its image data";
        return;
      }
      m.push(byte);
      return;
    }
    m.push(byte);
    if (m.length === 4) {
      const length = be16(m, 2);
      if (length < 2) this.failure = "its JPEG markers are broken";
      else if (!SOF.has(m[1] ?? 0)) {
        this.next = at + 1 + (length - 2); // past the segment
        this.marker = [];
      }
    } else if (m.length === 9) {
      this.size = { height: be16(m, 5), width: be16(m, 7) };
    }
  }

  /** The size, once the whole file (or enough of it) was fed; NotAPicture with the reason otherwise. */
  result(): { width: number; height: number } {
    if (this.failure) throw new NotAPicture(this.failure);
    if (!this.size) throw new NotAPicture("its size was not found in the file");
    return this.size;
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

/** The picture a file is, from its first bytes (up to HEADER_BYTES) and, for a JPEG, the scan of the whole file (a
 * scan of just the head when none is given); NotAPicture with the reason otherwise. */
export function picture(head: Uint8Array, scan?: JpegScan): Picture {
  let found: Picture;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    let jpeg = scan;
    if (!jpeg) {
      jpeg = new JpegScan();
      jpeg.feed(head);
    }
    found = { mime: "image/jpeg", ...jpeg.result() };
  } else if (ascii(head, 0, "\x89PNG\r\n\x1a\n")) found = { mime: "image/png", ...png(head) };
  else if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) found = { mime: "image/webp", ...webp(head) };
  else if (
    ascii(head, 4, "ftyp") &&
    /^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(String.fromCharCode(...head.slice(8, 12)))
  ) {
    throw new NotAPicture("it is a HEIC or AVIF picture, which Pageinator does not take yet: save it as JPEG");
  } else throw new NotAPicture("it is not a JPEG, PNG or WebP file");
  if (found.width < 1 || found.height < 1) throw new NotAPicture("it says it has no width or height");
  if (found.width > MAX_SIDE || found.height > MAX_SIDE) throw new NotAPicture("a side is over 100000 pixels");
  if (found.width * found.height > MAX_PIXELS) throw new NotAPicture("it is larger than 100 megapixels");
  return found;
}

/** The file name's extension for a type, for downloads. */
export const EXTENSION: Record<Mime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
