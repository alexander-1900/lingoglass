// Cover-image plumbing (Phase 5): pure byte-level inspection of an upload
// (type sniffing + dimensions), the sha256, and the content-addressed R2 key
// the story_images schema promises ("covers/<lang>/<level>/<slug>/<sha>.<ext>").
// No Workers types here — tests/admin-images.test.ts imports this in Node, and
// the route files are the only place that touches MEDIA/D1.

/** The three types story_images.content_type accepts (schema CHECK). */
export const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export interface SniffedImage {
  contentType: ImageContentType;
  width: number;
  height: number;
}

/** One story_images row — the D1 contract shared with functions/_lib/story-db.ts. */
export interface StoryImageRow {
  id: number;
  story_id: number;
  r2_key: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  is_cover: number;
  uploaded_at: number;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Sanity bound for any dimension we read out of a header (never trust bytes). */
const DIM_MAX = 65535;

function be16(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}
function be32(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}
function le16(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}
function le24(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

function sniffPng(b: Uint8Array): SniffedImage | null {
  if (b.length < 24) return null;
  for (let i = 0; i < PNG_MAGIC.length; i++) if (b[i] !== PNG_MAGIC[i]) return null;
  // First chunk must be IHDR (bytes 12..15: "IHDR"), dimensions follow big-endian.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const width = be32(b, 16);
  const height = be32(b, 20);
  if (width < 1 || height < 1 || width > DIM_MAX || height > DIM_MAX) return null;
  return { contentType: "image/png", width, height };
}

function sniffJpeg(b: Uint8Array): SniffedImage | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  // Walk the marker segments until a Start-Of-Frame carries the dimensions.
  // Markers without a length field: SOI/EOI, RSTn, TEM.
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i++; // fill bytes
    if (i >= b.length) return null;
    const marker = b[i++];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 1 >= b.length) return null;
    const segLen = be16(b, i);
    if (segLen < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 6 >= b.length) return null;
      const height = be16(b, i + 3);
      const width = be16(b, i + 5);
      if (width < 1 || height < 1) return null;
      return { contentType: "image/jpeg", width, height };
    }
    i += segLen; // segment length includes its own 2 bytes
  }
  return null;
}

function sniffWebp(b: Uint8Array): SniffedImage | null {
  // RIFF....WEBP + chunk fourcc at 12, payload at 20.
  if (b.length < 30) return null;
  if (b[0] !== 0x52 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x46) return null;
  if (b[8] !== 0x57 || b[9] !== 0x45 || b[10] !== 0x42 || b[11] !== 0x50) return null;
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  let width = 0;
  let height = 0;
  if (fourcc === "VP8 ") {
    // Lossy: 3-byte frame tag, 9D 01 2A start code, then 14-bit LE dimensions.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    width = le16(b, 26) & 0x3fff;
    height = le16(b, 28) & 0x3fff;
  } else if (fourcc === "VP8L") {
    // Lossless: signature 0x2F, then packed width-1/height-1 (14 bits each).
    if (b[20] !== 0x2f) return null;
    width = 1 + (b[21] | ((b[22] & 0x3f) << 8));
    height = 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10));
  } else if (fourcc === "VP8X") {
    // Extended: canvas width-1/height-1 as 24-bit LE at payload offset 4.
    width = 1 + le24(b, 24);
    height = 1 + le24(b, 27);
  } else {
    return null;
  }
  if (width < 1 || height < 1 || width > DIM_MAX || height > DIM_MAX) return null;
  return { contentType: "image/webp", width, height };
}

/**
 * Identify an upload by its BYTES (never by the client-declared Content-Type)
 * and read its dimensions from the header. Returns null for anything that is
 * not a JPEG/PNG/WebP — the route maps that to 415.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === PNG_MAGIC[0] && bytes[1] === PNG_MAGIC[1]) return sniffPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return sniffJpeg(bytes);
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return sniffWebp(bytes);
  return null;
}

/** Lowercase hex sha256 of the upload — doubles as the dedupe identity. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const EXT_BY_TYPE: Record<ImageContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Content-addressed object key — identical bytes under one story collide to
 *  one object (the story_images.r2_key UNIQUE constraint says the same). */
export function imageR2Key(
  lang: string,
  level: string,
  slug: string,
  sha256: string,
  contentType: ImageContentType
): string {
  return `covers/${lang}/${level}/${slug}/${sha256}.${EXT_BY_TYPE[contentType]}`;
}

/** API JSON shape for one image (url is same-origin and session-gated). */
export function imageJson(storyId: number, row: StoryImageRow) {
  return {
    id: row.id,
    url: `/api/admin/stories/${storyId}/images/${row.id}`,
    contentType: row.content_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    isCover: row.is_cover === 1,
    uploadedAt: row.uploaded_at,
  };
}
