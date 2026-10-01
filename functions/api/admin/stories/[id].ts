// GET    /api/admin/stories/:id — full story: metadata + sentences + words.
// PUT    /api/admin/stories/:id — full replace with an optimistic-lock check
//                                 (body.updatedAt must match, else 409).
// DELETE /api/admin/stories/:id — SOFT delete (trash); restore via
//                                 POST /api/admin/stories/:id/restore.
// Auth + CSRF: functions/api/admin/_middleware.ts covers this subtree.

import type { Env, AdminData } from "../../../_lib/env";
import { ApiError, json, methodNotAllowed, readJson } from "../../../_lib/http";
import { audit } from "../../../_lib/audit";
import { parseStoryIdParam, parseStoryInput, storySummaryJson, type StoryRow } from "../../../_lib/stories";
import {
  findSlugHolder,
  getCoverImageId,
  getStoryContent,
  getStoryRow,
  softDeleteStory,
  updateStory,
  type StoryContentSentence,
} from "../../../_lib/story-db";

const MAX_BODY_BYTES = 262144;

function storyNotFound(): ApiError {
  return new ApiError(404, "story_not_found", "Story not found");
}

function storyDetailJson(row: StoryRow, sentences: StoryContentSentence[], coverImageId: number | null) {
  return { ...storySummaryJson(row), sentenceCount: sentences.length, coverImageId, sentences };
}

async function readDetail(env: Env, row: StoryRow) {
  const [sentences, coverImageId] = await Promise.all([
    getStoryContent(env, row.id),
    getCoverImageId(env, row.id),
  ]);
  return json({ story: storyDetailJson(row, sentences, coverImageId) });
}

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data, params } = context;
  const method = request.method.toUpperCase();
  const session = data.session;
  if (!session) throw new ApiError(401, "auth_required", "Authentication required");

  const id = parseStoryIdParam(params.id);
  const row = id === null ? null : await getStoryRow(env, id);
  if (id === null || !row) throw storyNotFound();
  const now = Math.floor(Date.now() / 1000);

  if (method === "GET") {
    return readDetail(env, row);
  }

  if (method === "PUT") {
    // Editing a trashed story is off-limits — restore first (one path in, one out).
    if (row.deleted_at !== null) {
      throw new ApiError(409, "story_deleted", "This story is in the trash — restore it before editing");
    }

    const body = await readJson(request, MAX_BODY_BYTES);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ApiError(400, "invalid_story", "Body must be a JSON object");
    }
    // Optimistic lock: the editor echoes the updatedAt it loaded. Equal-second
    // writes are theoretically indistinguishable (epoch-seconds convention),
    // but a single operator's editor always sends its own last-seen value, so
    // the practical window for two-session clobbering is sub-second.
    const expect = (body as Record<string, unknown>).updatedAt;
    if (expect !== undefined && expect !== null) {
      if (typeof expect !== "number" || !Number.isInteger(expect)) {
        throw new ApiError(400, "invalid_story", "updatedAt must be an integer (unix seconds)", undefined, [
          { field: "updatedAt", message: "must be an integer" },
        ]);
      }
      if (expect !== row.updated_at) {
        throw new ApiError(
          409,
          "conflict",
          "The story changed since it was loaded — reload and re-apply your edits",
          undefined,
          { updatedAt: row.updated_at }
        );
      }
    }

    const parsed = parseStoryInput(body);
    if (!parsed.ok) {
      throw new ApiError(400, "invalid_story", "Story validation failed", undefined, parsed.issues);
    }
    const input = parsed.value;

    const moved = input.lang !== row.lang || input.level !== row.level || input.slug !== row.slug;
    if (moved) {
      const holder = await findSlugHolder(env, input.lang, input.level, input.slug, id);
      if (holder) {
        throw new ApiError(
          409,
          "slug_taken",
          `${input.lang}/${input.level}/${input.slug} is already used by a ${
            holder.deleted_at !== null ? "deleted" : "live"
          } story`,
          undefined,
          { storyId: holder.id, deleted: holder.deleted_at !== null }
        );
      }
    }

    await updateStory(env, id, input, now);
    await audit(
      env,
      {
        userId: session.userId,
        action: "story.update",
        entityType: "story",
        entityId: id,
        detail: moved
          ? {
              from: { lang: row.lang, level: row.level, slug: row.slug },
              to: { lang: input.lang, level: input.level, slug: input.slug },
              sentences: input.sentences.length,
            }
          : { lang: input.lang, level: input.level, slug: input.slug, sentences: input.sentences.length },
      },
      now
    );

    const fresh = (await getStoryRow(env, id)) ?? row;
    return readDetail(env, fresh);
  }

  if (method === "DELETE") {
    // Idempotent: deleting an already-trashed story reports its original date.
    if (row.deleted_at !== null) {
      return json({ ok: true, id, deletedAt: row.deleted_at, alreadyDeleted: true });
    }
    await softDeleteStory(env, id, now);
    await audit(
      env,
      {
        userId: session.userId,
        action: "story.delete",
        entityType: "story",
        entityId: id,
        detail: { lang: row.lang, level: row.level, slug: row.slug, wasPublished: row.status === "published" },
      },
      now
    );
    return json({ ok: true, id, deletedAt: now });
  }

  return methodNotAllowed("GET", "PUT", "DELETE");
};
