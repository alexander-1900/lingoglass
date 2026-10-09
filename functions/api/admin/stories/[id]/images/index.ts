// GET  /api/admin/stories/:id/images — the story's gallery, cover first.
// POST /api/admin/stories/:id/images — upload ONE image as the raw body:
//   size cap (ADMIN_MAX_UPLOAD_BYTES) → byte sniffing (never the declared
//   Content-Type) → sha256 → R2 put → story_images row. Identical bytes under
//   the same story dedupe onto one row; the FIRST image becomes the cover.
// Auth + CSRF: functions/api/admin/_middleware.ts covers this subtree.

import { intVar, type Env, type AdminData } from "../../../../../_lib/env";
import { ApiError, json, methodNotAllowed } from "../../../../../_lib/http";
import { audit } from "../../../../../_lib/audit";
import { imageJson, imageR2Key, sha256Hex, sniffImage } from "../../../../../_lib/images";
import { parseStoryIdParam } from "../../../../../_lib/stories";
import {
  getCoverImageId,
  getStoryImageByKey,
  getStoryRow,
  insertStoryImage,
  listStoryImages,
} from "../../../../../_lib/story-db";

function storyNotFound(): ApiError {
  return new ApiError(404, "story_not_found", "Story not found");
}

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data, params } = context;
  const method = request.method.toUpperCase();
  const session = data.session;
  if (!session) throw new ApiError(401, "auth_required", "Authentication required");

  const id = parseStoryIdParam(params.id);
  const row = id === null ? null : await getStoryRow(env, id);
  if (id === null || !row) throw storyNotFound();

  if (method === "GET") {
    const images = await listStoryImages(env, id);
    return json({ images: images.map((image) => imageJson(id, image)) });
  }

  if (method === "POST") {
    if (row.deleted_at !== null) {
      throw new ApiError(409, "story_deleted", "This story is in the trash — restore it before editing");
    }

    const maxBytes = intVar(env, "ADMIN_MAX_UPLOAD_BYTES", 5242880, 1024, 10485760);
    const declared = Number(request.headers.get("Content-Length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new ApiError(413, "too_large", `Image must be at most ${maxBytes} bytes`);
    }
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength === 0) throw new ApiError(400, "empty_upload", "No image data received");
    if (buffer.byteLength > maxBytes) {
      throw new ApiError(413, "too_large", `Image must be at most ${maxBytes} bytes`);
    }

    const bytes = new Uint8Array(buffer);
    const sniffed = sniffImage(bytes);
    if (!sniffed) throw new ApiError(415, "unsupported_image", "Only JPEG, PNG or WebP images are accepted");

    const sha256 = await sha256Hex(bytes);
    const r2Key = imageR2Key(row.lang, row.level, row.slug, sha256, sniffed.contentType);

    const existing = await getStoryImageByKey(env, id, r2Key);
    if (existing) return json({ image: imageJson(id, existing), created: false });

    await env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: sniffed.contentType } });
    const now = Math.floor(Date.now() / 1000);
    const hasCover = (await getCoverImageId(env, id)) !== null;
    const inserted = await insertStoryImage(env, {
      story_id: id,
      r2_key: r2Key,
      content_type: sniffed.contentType,
      byte_size: bytes.byteLength,
      sha256,
      width: sniffed.width,
      height: sniffed.height,
      is_cover: hasCover ? 0 : 1,
      uploaded_at: now,
    });
    await audit(
      env,
      {
        userId: session.userId,
        action: "story.image_add",
        entityType: "story",
        entityId: id,
        detail: {
          imageId: inserted.id,
          contentType: sniffed.contentType,
          byteSize: bytes.byteLength,
          sha256,
          becameCover: inserted.is_cover === 1,
        },
      },
      now
    );
    return json({ image: imageJson(id, inserted), created: true }, 201);
  }

  return methodNotAllowed("GET", "POST");
};
