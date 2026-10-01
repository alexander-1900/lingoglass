// D1 access for the /admin stories API (Phase 3). Split from stories.ts so the
// pure validation rules stay importable by the root tsconfig (tests) without
// pulling Workers-only types into that program. Every statement is a prepared
// .bind() call; the only concatenated SQL is fixed fragments + bound params.

import type { Env } from "./env";
import { storyListJson, type StoryInput, type StoryListRow, type StoryRow, type StorySentenceInput } from "./stories";

const STORY_COLUMNS =
  "id, lang, level, slug, title, title_en, minutes, status, source, " +
  "created_at, updated_at, published_at, deleted_at";
const STORY_COLUMNS_S = STORY_COLUMNS.split(", ")
  .map((c) => `s.${c}`)
  .join(", ");

export interface ListFilters {
  lang?: string;
  level?: string;
  status: "all" | "draft" | "published";
  /** deleted=false → live rows only; deleted=true → the trash. */
  deleted: boolean;
  q?: string;
  limit: number;
  offset: number;
}

export interface StoryListPage {
  stories: ReturnType<typeof storyListJson>[];
  total: number;
  /** "NN" suggestion for the next story in the filtered lang/level. */
  nextSlugIndex?: string;
}

export async function listStories(env: Env, f: ListFilters): Promise<StoryListPage> {
  const where: string[] = [f.deleted ? "s.deleted_at IS NOT NULL" : "s.deleted_at IS NULL"];
  const binds: (string | number)[] = [];
  if (f.lang) {
    where.push("s.lang = ?");
    binds.push(f.lang);
  }
  if (f.level) {
    where.push("s.level = ?");
    binds.push(f.level);
  }
  if (f.status !== "all") {
    where.push("s.status = ?");
    binds.push(f.status);
  }
  if (f.q) {
    where.push("(s.title LIKE ? OR s.title_en LIKE ? OR s.slug LIKE ?)");
    const like = `%${f.q}%`;
    binds.push(like, like, like);
  }
  const clause = where.join(" AND ");

  const page = await env.DB.prepare(
    `SELECT ${STORY_COLUMNS_S}, ` +
      "(SELECT COUNT(*) FROM sentences c WHERE c.story_id = s.id) AS sentence_count, " +
      "(SELECT i.id FROM story_images i WHERE i.story_id = s.id AND i.is_cover = 1) AS cover_image_id " +
      `FROM stories s WHERE ${clause} ORDER BY s.updated_at DESC, s.id DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, f.limit, f.offset)
    .all<StoryListRow>();
  const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM stories s WHERE ${clause}`)
    .bind(...binds)
    .first<{ c: number }>();

  const result: StoryListPage = {
    stories: (page.results ?? []).map(storyListJson),
    total: count?.c ?? 0,
  };
  if (f.lang && f.level) result.nextSlugIndex = await nextSlugPrefix(env, f.lang, f.level);
  return result;
}

/** Highest NN prefix in use for a lang/level (deleted rows included — an NN
 *  that was ever used does not come back), wrapped at 99. */
export async function nextSlugPrefix(env: Env, lang: string, level: string): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT MAX(CAST(substr(slug, 1, 2) AS INTEGER)) AS m FROM stories " +
      "WHERE lang = ? AND level = ? AND slug GLOB '[0-9][0-9]-*'"
  )
    .bind(lang, level)
    .first<{ m: number | null }>();
  return String(Math.min(99, (row?.m ?? 0) + 1)).padStart(2, "0");
}

export async function getStoryRow(env: Env, id: number): Promise<StoryRow | null> {
  return (
    (await env.DB.prepare(`SELECT ${STORY_COLUMNS} FROM stories WHERE id = ?`)
      .bind(id)
      .first<StoryRow>()) ?? null
  );
}

export interface StoryContentSentence {
  target: string;
  en: string;
  words: { surface: string; note: string }[];
}

export async function getStoryContent(env: Env, storyId: number): Promise<StoryContentSentence[]> {
  const sentences = await env.DB.prepare(
    "SELECT position, target, en FROM sentences WHERE story_id = ? ORDER BY position"
  )
    .bind(storyId)
    .all<{ position: number; target: string; en: string }>();
  const words = await env.DB.prepare(
    "SELECT se.position AS s_pos, w.surface, w.note FROM words w " +
      "JOIN sentences se ON se.id = w.sentence_id WHERE se.story_id = ? " +
      "ORDER BY se.position, w.position"
  )
    .bind(storyId)
    .all<{ s_pos: number; surface: string; note: string }>();

  const byPosition = new Map<number, { surface: string; note: string }[]>();
  for (const w of words.results ?? []) {
    const list = byPosition.get(w.s_pos) ?? [];
    list.push({ surface: w.surface, note: w.note });
    byPosition.set(w.s_pos, list);
  }
  return (sentences.results ?? []).map((s) => ({
    target: s.target,
    en: s.en,
    words: byPosition.get(s.position) ?? [],
  }));
}

export async function getCoverImageId(env: Env, storyId: number): Promise<number | null> {
  const row = await env.DB.prepare(
    "SELECT id FROM story_images WHERE story_id = ? AND is_cover = 1"
  )
    .bind(storyId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/** Slug holder in the same lang/level — deleted rows count (UNIQUE covers
 *  them; a URL never gets recycled). */
export async function findSlugHolder(
  env: Env,
  lang: string,
  level: string,
  slug: string,
  excludeId?: number
): Promise<{ id: number; deleted_at: number | null } | null> {
  const row = await env.DB.prepare(
    "SELECT id, deleted_at FROM stories WHERE lang = ? AND level = ? AND slug = ? AND id != ?"
  )
    .bind(lang, level, slug, excludeId ?? -1)
    .first<{ id: number; deleted_at: number | null }>();
  return row ?? null;
}

/**
 * Content rows for one story as one atomic batch. Word rows resolve their
 * sentence_id inside SQL (`SELECT id FROM sentences ...`), so no extra round
 * trip is needed to learn inserted sentence ids; statements execute in order
 * within the batch transaction, so prior INSERTs are visible to later SELECTs.
 */
function contentStatements(
  env: Env,
  storyId: number,
  sentences: StorySentenceInput[],
  clearFirst: boolean
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  if (clearFirst) stmts.push(env.DB.prepare("DELETE FROM sentences WHERE story_id = ?").bind(storyId));
  sentences.forEach((s, pos) => {
    stmts.push(
      env.DB.prepare("INSERT INTO sentences (story_id, position, target, en) VALUES (?, ?, ?, ?)").bind(
        storyId,
        pos,
        s.target,
        s.en
      )
    );
    s.words.forEach((w, wPos) => {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO words (sentence_id, position, surface, note) " +
            "SELECT id, ?, ?, ? FROM sentences WHERE story_id = ? AND position = ?"
        ).bind(wPos, w.surface, w.note, storyId, pos)
      );
    });
  });
  return stmts;
}

/** New DRAFT story. The story row must exist before its sentences can bind to
 *  it; if the content batch fails, the row is hard-deleted again (it has no
 *  references yet, so the cascade cleanup is complete) and the error rethrown. */
export async function createStory(env: Env, input: StoryInput, now: number): Promise<number> {
  const inserted = await env.DB.prepare(
    "INSERT INTO stories (lang, level, slug, title, title_en, minutes, status, source, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'draft', 'admin', ?, ?)"
  )
    .bind(input.lang, input.level, input.slug, input.title, input.titleEn, input.minutes, now, now)
    .run();
  const id = Number(inserted.meta.last_row_id);
  try {
    await env.DB.batch(contentStatements(env, id, input.sentences, false));
  } catch (err) {
    try {
      await env.DB.prepare("DELETE FROM stories WHERE id = ?").bind(id).run();
    } catch (cleanupErr) {
      console.error(
        "[story] create cleanup failed:",
        cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
      );
    }
    throw err;
  }
  return id;
}

/** Full metadata + content replace, one transaction. */
export async function updateStory(env: Env, id: number, input: StoryInput, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE stories SET lang = ?, level = ?, slug = ?, title = ?, title_en = ?, minutes = ?, updated_at = ? WHERE id = ?"
    ).bind(input.lang, input.level, input.slug, input.title, input.titleEn, input.minutes, now, id),
    ...contentStatements(env, id, input.sentences, true),
  ]);
}

/** Soft delete (schema contract): the slug stays reserved, D1 Time Travel can
 *  restore within 7 days, and Phase 6 skips deleted rows when exporting. */
export async function softDeleteStory(env: Env, id: number, now: number): Promise<void> {
  await env.DB.prepare("UPDATE stories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(now, now, id)
    .run();
}

/** Undo a soft delete. Returns false when the row was not deleted. */
export async function restoreStory(env: Env, id: number, now: number): Promise<boolean> {
  const res = await env.DB.prepare(
    "UPDATE stories SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL"
  )
    .bind(now, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
