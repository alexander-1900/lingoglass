// POST /api/admin/stories/:id/images/:imageId/cover — make this image THE
// cover of the story (exactly one per story: the old cover clears in the same
// batch that sets the new one). Idempotent when it already is the cover.
// Auth + CSRF: functions/api/admin/_middleware.ts covers this subtree.

import type { Env, AdminData } from "../../../../../../_lib/env";
import { ApiError, json, methodNotAllowed } from "../../../../../../_lib/http";
import { audit } from "../../../../../../_lib/audit";
import { parseStoryIdParam } from "../../../../../../_lib/stories";
import { getStoryImageRow, getStoryRow, setCoverImage } from "../../../../../../_lib/story-db";

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data, params } = context;
  const method = request.method.toUpperCase();
  const session = data.session;
  if (!session) throw new ApiError(401, "auth_required", "Authentication required");
  if (method !== "POST") return methodNotAllowed("POST");

  const id = parseStoryIdParam(params.id);
  const imageId = parseStoryIdParam(params.imageId);
  const row = id === null ? null : await getStoryRow(env, id);
  if (id === null || !row) throw new ApiError(404, "story_not_found", "Story not found");
  if (imageId === null) throw new ApiError(404, "image_not_found", "Image not found");
  if (row.deleted_at !== null) {
    throw new ApiError(409, "story_deleted", "This story is in the trash — restore it before editing");
  }

  const image = await getStoryImageRow(env, id, imageId);
  if (!image) throw new ApiError(404, "image_not_found", "Image not found");
  if (image.is_cover === 1) return json({ ok: true, coverImageId: imageId, alreadyCover: true });

  await setCoverImage(env, id, imageId);
  const now = Math.floor(Date.now() / 1000);
  await audit(
    env,
    {
      userId: session.userId,
      action: "story.image_cover",
      entityType: "story",
      entityId: id,
      detail: { imageId, sha256: image.sha256 },
    },
    now
  );
  return json({ ok: true, coverImageId: imageId, alreadyCover: false });
};
