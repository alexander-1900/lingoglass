// POST /api/admin/stories/:id/publish — draft → published. Publishing makes the
// story eligible for scripts/sync-content.mjs (the static build's content/ is
// exported from D1); it does NOT rebuild the site by itself — that is what the
// "Publish site" button (POST /api/admin/publish, deploy hook) is for.
// Idempotent like restore: an already-published story answers 200
// {published:false}. Optional body {updatedAt} takes the same optimistic lock
// as PUT, so a click racing a save in another tab fails loudly with a 409.
// Auth + CSRF: functions/api/admin/_middleware.ts covers this subtree.

import type { Env, AdminData } from "../../../../_lib/env";
import { ApiError, json, methodNotAllowed } from "../../../../_lib/http";
import { audit } from "../../../../_lib/audit";
import { checkUpdatedAtLock, parseStoryIdParam, planPublish, storySummaryJson } from "../../../../_lib/stories";
import { getStoryRow, publishStory } from "../../../../_lib/story-db";

const MAX_BODY_BYTES = 2048;

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data, params } = context;
  if (request.method.toUpperCase() !== "POST") return methodNotAllowed("POST");
  const session = data.session;
  if (!session) throw new ApiError(401, "auth_required", "Authentication required");

  const id = parseStoryIdParam(params.id);
  const row = id === null ? null : await getStoryRow(env, id);
  if (id === null || !row) throw new ApiError(404, "story_not_found", "Story not found");
  const now = Math.floor(Date.now() / 1000);

  // Body is optional (curl-friendly); when present it may carry the lock token.
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new ApiError(413, "too_large", "Request body too large");
  }
  let expect: unknown;
  if (text.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(400, "invalid_json", "Malformed JSON body");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ApiError(400, "invalid_publish", "Body must be a JSON object");
    }
    expect = (parsed as Record<string, unknown>).updatedAt;
  }

  const lock = checkUpdatedAtLock(row, expect);
  if (!lock.ok) {
    throw new ApiError(
      lock.code === "conflict" ? 409 : 400,
      lock.code,
      lock.message,
      undefined,
      lock.updatedAt !== undefined ? { updatedAt: lock.updatedAt } : undefined
    );
  }

  const plan = planPublish(row);
  if (plan.action === "reject") {
    throw new ApiError(409, plan.code, plan.message);
  }
  if (plan.action === "noop") {
    return json({ ok: true, id, published: false, alreadyPublished: true, story: storySummaryJson(row) });
  }

  // The conditional UPDATE is the race guard: if the story got trashed (or
  // published) between the read above and this write, changes === 0.
  const changed = await publishStory(env, id, now);
  if (!changed) {
    const fresh = (await getStoryRow(env, id)) ?? row;
    if (fresh.deleted_at !== null) {
      throw new ApiError(409, "story_deleted", "This story is in the trash — restore it before publishing");
    }
    return json({ ok: true, id, published: false, alreadyPublished: true, story: storySummaryJson(fresh) });
  }

  await audit(
    env,
    {
      userId: session.userId,
      action: "story.publish",
      entityType: "story",
      entityId: id,
      detail: { lang: row.lang, level: row.level, slug: row.slug },
    },
    now
  );
  const fresh = (await getStoryRow(env, id)) ?? row;
  return json({ ok: true, id, published: true, story: storySummaryJson(fresh) });
};
