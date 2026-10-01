// GET  /api/admin/stories — browse/filter/search (live rows, trash, statuses).
// POST /api/admin/stories — create a DRAFT story with its full content.
// Auth + CSRF: functions/api/admin/_middleware.ts covers this whole subtree;
// the session is guaranteed here (401 thrown defensively otherwise).

import type { Env, AdminData } from "../../../_lib/env";
import { ApiError, json, methodNotAllowed, readJson } from "../../../_lib/http";
import { audit } from "../../../_lib/audit";
import {
  isAnyLevel,
  isLang,
  isLevelFor,
  LIMITS,
  parseStoryInput,
  storySummaryJson,
  type ValidationIssue,
} from "../../../_lib/stories";
import {
  createStory,
  findSlugHolder,
  getStoryRow,
  listStories,
  type ListFilters,
} from "../../../_lib/story-db";

/** Worst-case real stories serialize to ~60 KB; 256 KB is headroom, not a target. */
const MAX_BODY_BYTES = 262144;

function parseListQuery(url: URL): ListFilters {
  const sp = url.searchParams;
  const issues: ValidationIssue[] = [];

  const lang = sp.get("lang") ?? undefined;
  if (lang !== undefined && !isLang(lang)) {
    issues.push({ field: "lang", message: "must be one of: es, ru, ja" });
  }

  const level = sp.get("level") ?? undefined;
  if (level !== undefined) {
    const ok = isLang(lang) ? isLevelFor(lang, level) : isAnyLevel(level);
    if (!ok) {
      issues.push({
        field: "level",
        message: `not a valid level${isLang(lang) ? ` for "${lang}"` : ""}`,
      });
    }
  }

  const status = sp.get("status") ?? "all";
  if (status !== "all" && status !== "draft" && status !== "published") {
    issues.push({ field: "status", message: "must be all, draft or published" });
  }

  const q = sp.get("q") ?? undefined;
  if (q !== undefined && q.length > LIMITS.query) {
    issues.push({ field: "q", message: `at most ${LIMITS.query} characters` });
  }

  const limitRaw = sp.get("limit") ?? "50";
  const limit = Number(limitRaw);
  if (!/^\d{1,3}$/.test(limitRaw) || limit < 1 || limit > 100) {
    issues.push({ field: "limit", message: "must be an integer between 1 and 100" });
  }

  const offsetRaw = sp.get("offset") ?? "0";
  const offset = Number(offsetRaw);
  if (!/^\d{1,9}$/.test(offsetRaw)) {
    issues.push({ field: "offset", message: "must be a non-negative integer" });
  }

  if (issues.length > 0) throw new ApiError(400, "invalid_query", "Invalid query parameters", undefined, issues);
  return {
    lang,
    level,
    status: status as ListFilters["status"],
    deleted: sp.get("deleted") === "1",
    q: q || undefined,
    limit,
    offset,
  };
}

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data } = context;
  const method = request.method.toUpperCase();
  const session = data.session;
  if (!session) throw new ApiError(401, "auth_required", "Authentication required");
  const now = Math.floor(Date.now() / 1000);

  if (method === "GET") {
    const filters = parseListQuery(new URL(request.url));
    const page = await listStories(env, filters);
    return json({
      stories: page.stories,
      total: page.total,
      limit: filters.limit,
      offset: filters.offset,
      ...(page.nextSlugIndex !== undefined ? { nextSlugIndex: page.nextSlugIndex } : {}),
    });
  }

  if (method === "POST") {
    const parsed = parseStoryInput(await readJson(request, MAX_BODY_BYTES));
    if (!parsed.ok) {
      throw new ApiError(400, "invalid_story", "Story validation failed", undefined, parsed.issues);
    }
    const input = parsed.value;

    const holder = await findSlugHolder(env, input.lang, input.level, input.slug);
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

    const id = await createStory(env, input, now);
    await audit(
      env,
      {
        userId: session.userId,
        action: "story.create",
        entityType: "story",
        entityId: id,
        detail: { lang: input.lang, level: input.level, slug: input.slug, sentences: input.sentences.length },
      },
      now
    );
    const row = await getStoryRow(env, id);
    return json({ story: row ? storySummaryJson(row) : { id } }, 201);
  }

  return methodNotAllowed("GET", "POST");
};
