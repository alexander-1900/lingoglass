// GET    /api/admin/stories/:id/images/:imageId — the image bytes. Session
//        gated, same-origin: the editor previews it straight from this URL.
// DELETE /api/admin/stories/:id/images/:imageId — remove the image: D1 row
//        first, then its R2 object (r2_key is UNIQUE, so the object is 1:1
//        with the row — nothing else can still reference it). Audited.
// Auth + CSRF: functions/api/admin/_middleware.ts covers this subtree.

import type { Env, AdminData } from "../../../../../_lib/env";
import { ApiError, json, methodNotAllowed } from "../../../../../_lib/http";
import { audit } from "../../../../../_lib/audit";
import { parseStoryIdParam } from "../../../../../_lib/stories";
import { deleteStoryImage, getStoryImageRow, getStoryRow } from "../../../../../_lib/story-db";

function storyNotFound(): ApiError {
  return new ApiError(404, "story_not_found", "Story not found");
}
function imageNotFound(): ApiError {
  return new ApiError(404, "image_not_found", "Image not found");
}

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data, params } = context;
  const method = request.method.toUpperCase();
  const session = data.session;
  if (!session) throw new ApiError(401, "auth_required", "Authentication required");

  const id = parseStoryIdParam(params.id);
  const imageId = parseStoryIdParam(params.imageId);
  const row = id === null ? null : await getStoryRow(env, id);
  if (id === null || !row) throw storyNotFound();
  if (imageId === null) throw imageNotFound();

  if (method === "GET") {
    const image = await getStoryImageRow(env, id, imageId);
    if (!image) throw imageNotFound();
    const object = await env.MEDIA.get(image.r2_key);
    if (!object) throw new ApiError(404, "image_missing", "Image bytes are missing from storage");
    return new Response(object.body, {
      headers: {
        "Content-Type": image.content_type,
        "Content-Length": String(image.byte_size),
        // Content-addressed bytes never change — but applySecurityHeaders
        // rewrites Cache-Control to no-store for everything anyway.
        ETag: `"${image.sha256}"`,
      },
    });
  }

  if (method === "DELETE") {
    if (row.deleted_at !== null) {
      throw new ApiError(409, "story_deleted", "This story is in the trash — restore it before editing");
    }
    const deleted = await deleteStoryImage(env, id, imageId);
    if (!deleted) throw imageNotFound();
    try {
      await env.MEDIA.delete(deleted.r2_key);
    } catch (err) {
      // The row is gone; a stranded object is a storage curiosity, not a
      // user-facing failure. Same keys are content-addressed, so a re-upload
      // would simply overwrite it later.
      console.error("[images] R2 delete failed:", err instanceof Error ? err.message : String(err));
    }
    const now = Math.floor(Date.now() / 1000);
    await audit(
      env,
      {
        userId: session.userId,
        action: "story.image_delete",
        entityType: "story",
        entityId: id,
        detail: { imageId, sha256: deleted.sha256, wasCover: deleted.is_cover === 1 },
      },
      now
    );
    return json({ ok: true, id: imageId, wasCover: deleted.is_cover === 1 });
  }

  return methodNotAllowed("GET", "DELETE");
};
