// POST /api/admin/stories/:id/restore — undo a soft delete. 404 when the id
// never existed; a no-op 200 {restored:false} when the story is already live,
// so double-clicks and race-y UIs stay harmless.
// Auth + CSRF: functions/api/admin/_middleware.ts covers this subtree.

import type { Env, AdminData } from "../../../../_lib/env";
import { ApiError, json, methodNotAllowed } from "../../../../_lib/http";
import { audit } from "../../../../_lib/audit";
import { parseStoryIdParam, storySummaryJson } from "../../../../_lib/stories";
import { getStoryRow, restoreStory } from "../../../../_lib/story-db";

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data, params } = context;
  if (request.method.toUpperCase() !== "POST") return methodNotAllowed("POST");
  const session = data.session;
  if (!session) throw new ApiError(401, "auth_required", "Authentication required");

  const id = parseStoryIdParam(params.id);
  const row = id === null ? null : await getStoryRow(env, id);
  if (id === null || !row) throw new ApiError(404, "story_not_found", "Story not found");
  const now = Math.floor(Date.now() / 1000);

  if (row.deleted_at === null) {
    return json({ ok: true, restored: false, story: storySummaryJson(row) });
  }

  const restored = await restoreStory(env, id, now);
  await audit(
    env,
    {
      userId: session.userId,
      action: "story.restore",
      entityType: "story",
      entityId: id,
      detail: { lang: row.lang, level: row.level, slug: row.slug },
    },
    now
  );
  const fresh = (await getStoryRow(env, id)) ?? row;
  return json({ ok: true, restored, story: storySummaryJson(fresh) });
};
