// What a file is, from its bytes (src/modules/media/picture.ts), on fictional pictures made byte by byte.
import { describe, expect, it } from "vitest";
import { HEADER_BYTES, JpegScan, NotAPicture, picture } from "../../src/modules/media/picture.ts";
import { heic, jpeg, png, webp } from "../support/pictures.ts";

describe("picture()", () => {
  it.each([
    ["a JPEG", jpeg(4000, 3000), { mime: "image/jpeg", width: 4000, height: 3000 }],
    [
      "a JPEG with 1 MB of EXIF before its size",
      jpeg(1600, 1200, 1_000_000),
      { mime: "image/jpeg", width: 1600, height: 1200 },
    ],
    ["a PNG", png(800, 600), { mime: "image/png", width: 800, height: 600 }],
    ["a lossy WebP", webp("VP8 ", 1024, 768), { mime: "image/webp", width: 1024, height: 768 }],
    ["a lossless WebP", webp("VP8L", 300, 200), { mime: "image/webp", width: 300, height: 200 }],
    ["an extended WebP", webp("VP8X", 5000, 4000), { mime: "image/webp", width: 5000, height: 4000 }],
  ])("reads %s", (_name, bytes, expected) => {
    expect(picture(bytes)).toEqual(expected);
  });

  it.each([
    ["HEIC", heic(), "HEIC or AVIF"],
    ["text", new TextEncoder().encode("<html>not a picture</html>"), "not a JPEG, PNG or WebP"],
    ["a JPEG cut before its size", jpeg(10, 10).slice(0, 30), "not found in the file"],
    ["a JPEG cut in its size marker", jpeg(10, 10).slice(0, 35), "not found in the file"],
    ["a JPEG with broken markers", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0x12, 0x34, 0, 0]), "broken"],
    ["a JPEG with no frame", Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0]), "no frame"],
    ["a PNG with no IHDR", png(10, 10).slice(0, 12), "PNG header"],
    ["a PNG of no width", png(0, 10), "no width or height"],
    ["a 101-megapixel JPEG", jpeg(10_100, 10_000), "100 megapixels"],
    ["a PNG 200000 pixels wide", png(200_000, 1), "a side is over 100000 pixels"],
    ["a WebP 100001 pixels tall", webp("VP8X", 1, 100_001), "a side is over 100000 pixels"],
    [
      "a WebP of an unknown kind",
      Uint8Array.from([...webp("VP8X", 2, 2).slice(0, 12), 0x41, 0x42, 0x43, 0x44, ...new Array(20).fill(0)]),
      "kind",
    ],
  ])("refuses %s", (_name, bytes, reason) => {
    expect(() => picture(bytes)).toThrow(NotAPicture);
    expect(() => picture(bytes)).toThrow(reason);
  });
});

describe("JpegScan: a JPEG's size, however far into the file", () => {
  /** Feeds the file in chunks of this size, as the store's stream gives it. */
  function scanned(file: Uint8Array, chunk: number) {
    const scan = new JpegScan();
    for (let at = 0; at < file.length; at += chunk) scan.feed(file.subarray(at, at + chunk));
    return picture(file.subarray(0, HEADER_BYTES), scan);
  }

  it.each([1, 7, 4096, 65_536, 1_000_000])("finds it after 3 MB of EXIF, fed %i bytes at a time", (chunk) => {
    const file = jpeg(2400, 1600, 3 * 1024 * 1024, 5);
    expect(scanned(file, chunk)).toEqual({ mime: "image/jpeg", width: 2400, height: 1600 });
    // the head alone does not have it
    expect(() => picture(file.subarray(0, HEADER_BYTES))).toThrow("not found in the file");
  });

  it("reads fill bytes and markers without a length", () => {
    const file = jpeg(30, 20);
    // an RST marker and fill bytes before the comment (offset 20, after the JFIF segment)
    const filled = Uint8Array.from([...file.subarray(0, 20), 0xff, 0xd0, 0xff, 0xff, ...file.subarray(20)]);
    expect(scanned(filled, 3)).toEqual({ mime: "image/jpeg", width: 30, height: 20 });
  });

  it("refuses a file whose frame never comes", () => {
    const file = jpeg(10, 10, 100_000);
    expect(() => scanned(file.subarray(0, 90_000), 1000)).toThrow("not found in the file");
  });
});
