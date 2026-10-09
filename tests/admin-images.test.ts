// Phase 5 cover images — the pure byte layer, run headless in Node: magic-byte
// sniffing + header dimensions for the three allowed types, the sha256 identity
// and the content-addressed R2 key. The D1/R2 routes are exercised by the local
// E2E browser drive; everything here must hold without any Workers runtime.

import { describe, expect, it } from "vitest";
import {
  IMAGE_CONTENT_TYPES,
  imageJson,
  imageR2Key,
  sha256Hex,
  sniffImage,
  type StoryImageRow,
} from "../functions/_lib/images";

/** Minimal PNG: signature + IHDR (dimensions only — the sniffer never walks
 *  further; CRCs would only matter to a decoder). */
function pngFixture(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8); // IHDR chunk length
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  b.set([width >>> 24, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 16);
  b.set([height >>> 24, (height >>> 16) & 255, (height >>> 8) & 255, height & 255], 20);
  b.set([8, 2, 0, 0, 0], 24); // bit depth, colour type, …
  return b;
}

/** Minimal JPEG: SOI, an APP0 segment, then SOF0 carrying the dimensions. */
function jpegFixture(width: number, height: number): Uint8Array {
  const app0 = new Uint8Array(18); // marker (2) + length (2, value 16) + 14 bytes
  app0.set([0xff, 0xe0, 0x00, 0x10]);
  const sof = new Uint8Array(19); // marker (2) + length (2) + 15 bytes
  sof.set([0xff, 0xc0, 0x00, 0x11], 0); // SOF0, length 17
  sof[4] = 8; // precision
  sof[5] = (height >> 8) & 255;
  sof[6] = height & 255;
  sof[7] = (width >> 8) & 255;
  sof[8] = width & 255;
  sof[9] = 3; // component count
  const b = new Uint8Array(2 + app0.length + sof.length);
  b.set([0xff, 0xd8], 0); // SOI
  b.set(app0, 2);
  b.set(sof, 2 + app0.length);
  return b;
}

/** Minimal lossless WebP (VP8L): RIFF/WEBP header + signature + packed size. */
function webpLosslessFixture(width: number, height: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  b.set([24, 0, 0, 0], 4); // file size - 8
  b.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  b.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  b.set([12, 0, 0, 0], 16); // chunk size
  b[20] = 0x2f; // VP8L signature
  const w = width - 1;
  const h = height - 1;
  b[21] = w & 0xff;
  b[22] = ((w >> 8) & 0x3f) | ((h & 0x3f) << 6);
  b[23] = (h >> 2) & 0xff;
  b[24] = (h >> 10) & 0x0f;
  return b;
}

/** Minimal lossy WebP (VP8): frame tag + start code + 14-bit dimensions. */
function webpLossyFixture(width: number, height: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([24, 0, 0, 0], 4);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  b.set([16, 0, 0, 0], 16);
  b.set([0x00, 0x00, 0x00], 20); // frame tag
  b.set([0x9d, 0x01, 0x2a], 23); // start code
  b.set([width & 0xff, (width >> 8) & 0x3f], 26);
  b.set([height & 0xff, (height >> 8) & 0x3f], 28);
  return b;
}

describe("sniffImage", () => {
  it("identifies PNG and reads the IHDR dimensions", () => {
    expect(sniffImage(pngFixture(640, 480))).toEqual({ contentType: "image/png", width: 640, height: 480 });
  });

  it("identifies JPEG from the SOF0 segment", () => {
    expect(sniffImage(jpegFixture(1200, 800))).toEqual({ contentType: "image/jpeg", width: 1200, height: 800 });
  });

  it("identifies lossless WebP (VP8L)", () => {
    expect(sniffImage(webpLosslessFixture(120, 80))).toEqual({ contentType: "image/webp", width: 120, height: 80 });
  });

  it("identifies lossy WebP (VP8)", () => {
    expect(sniffImage(webpLossyFixture(320, 240))).toEqual({ contentType: "image/webp", width: 320, height: 240 });
  });

  it("rejects types the schema does not allow", () => {
    const gif = new TextEncoder().encode("GIF89a....");
    const bmp = new Uint8Array([0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImage(gif)).toBeNull();
    expect(sniffImage(bmp)).toBeNull();
    // A renamed file: bytes say text even though a client could claim image/png.
    expect(sniffImage(new TextEncoder().encode("just some plain text here"))).toBeNull();
  });

  it("rejects truncated or malformed headers", () => {
    expect(sniffImage(new Uint8Array(8))).toBeNull(); // too short for anything
    expect(sniffImage(pngFixture(0, 100))).toBeNull(); // zero width
    expect(sniffImage(jpegFixture(10, 10).slice(0, 10))).toBeNull(); // never reaches SOF0
    const badWebp = webpLosslessFixture(10, 10);
    badWebp.set([0x56, 0x50, 0x39, 0x58], 12); // "VP9X" — not a real chunk
    expect(sniffImage(badWebp)).toBeNull();
    const notIhdr = pngFixture(10, 10);
    notIhdr[14] = 0; // mangle "IHDR"
    expect(sniffImage(notIhdr)).toBeNull();
  });

  it("agrees with the three schema content types", () => {
    const found = [
      sniffImage(pngFixture(2, 2))?.contentType,
      sniffImage(jpegFixture(2, 2))?.contentType,
      sniffImage(webpLosslessFixture(2, 2))?.contentType,
    ];
    expect(found.sort()).toEqual([...IMAGE_CONTENT_TYPES].sort());
  });
});

describe("sha256Hex", () => {
  it("matches the known digests", async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("imageR2Key", () => {
  it("builds the schema's content-addressed path", () => {
    const sha = "a".repeat(64);
    expect(imageR2Key("es", "a1", "06-la-casa-nueva", sha, "image/jpeg")).toBe(
      `covers/es/a1/06-la-casa-nueva/${sha}.jpg`
    );
    expect(imageR2Key("ja", "n5", "01-neko", sha, "image/png")).toBe(`covers/ja/n5/01-neko/${sha}.png`);
    expect(imageR2Key("ru", "b2", "07-test", sha, "image/webp")).toBe(`covers/ru/b2/07-test/${sha}.webp`);
  });
});

describe("imageJson", () => {
  it("maps a row to the API shape with a session-gated url", () => {
    const row: StoryImageRow = {
      id: 9,
      story_id: 4,
      r2_key: `covers/es/a1/06-x/${"b".repeat(64)}.png`,
      content_type: "image/png",
      byte_size: 1234,
      sha256: "b".repeat(64),
      width: 800,
      height: 600,
      is_cover: 1,
      uploaded_at: 1791000000,
    };
    expect(imageJson(4, row)).toEqual({
      id: 9,
      url: "/api/admin/stories/4/images/9",
      contentType: "image/png",
      byteSize: 1234,
      sha256: "b".repeat(64),
      width: 800,
      height: 600,
      isCover: true,
      uploadedAt: 1791000000,
    });
    expect(imageJson(4, { ...row, is_cover: 0 }).isCover).toBe(false);
  });
});
