import { auth } from "@/auth";
import { db, type Db } from "@/db";
import { bookmarks as bookmarksTable, progress as progressTable, users } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { mergeBookmarks, mergeProgressMap } from "@/lib/sync";
import type { Bookmark } from "@/lib/bookmarks";
import type { ProgressMap, ProgressRecord, SyncRequest, SyncResponse } from "@/lib/sync-types";
import type { SyncBookmark } from "@/lib/sync-types";

/**
 * Full-state, last-write-wins sync. The client posts its entire (tiny)
 * state — bookmarks (incl. tombstones) + progress — and receives the
 * authoritative merged state back. Volumes are bounded (≤500 bookmarks,
 * ≤200 progress rows) so delta syncs would add complexity for nothing.
 *
 * Guards: 401 without a session, 503 when no database is configured,
 * 400 on malformed bodies. All merges run through the SAME pure functions
 * the client uses (lib/sync.ts), so both sides agree on conflict rules.
 */

const MAX_BOOKMARKS_IN = 1000;
const MAX_PROGRESS_IN = 500;

function rowToBookmark(r: typeof bookmarksTable.$inferSelect): Bookmark {
  return {
    id: r.id,
    word: r.word,
    note: r.note ?? "",
    englishMeaning: r.englishMeaning ?? undefined,
    reading: r.reading ?? undefined,
    romaji: r.romaji ?? undefined,
    context: r.context ?? "",
    contextEn: r.contextEn ?? "",
    lang: r.lang,
    level: r.level,
    slug: r.slug,
    sentIdx: r.sentIdx,
    savedAt: r.savedAt,
    deletedAt: r.deletedAt ?? undefined,
    updatedAt: r.updatedAt,
  };
}

function sanitizeBookmark(v: unknown): SyncBookmark | null {
  if (typeof v !== "object" || v === null) return null;
  const b = v as Partial<Bookmark>;
  if (
    typeof b.id !== "string" || typeof b.word !== "string" ||
    typeof b.lang !== "string" || typeof b.level !== "string" ||
    typeof b.slug !== "string" || typeof b.sentIdx !== "number" ||
    typeof b.savedAt !== "number"
  ) return null;
  return {
    id: b.id.slice(0, 64),
    word: b.word.slice(0, 200),
    note: typeof b.note === "string" ? b.note.slice(0, 500) : "",
    englishMeaning: typeof b.englishMeaning === "string" ? b.englishMeaning.slice(0, 300) : undefined,
    reading: typeof b.reading === "string" ? b.reading.slice(0, 100) : undefined,
    romaji: typeof b.romaji === "string" ? b.romaji.slice(0, 100) : undefined,
    context: typeof b.context === "string" ? b.context.slice(0, 500) : "",
    contextEn: typeof b.contextEn === "string" ? b.contextEn.slice(0, 500) : "",
    lang: b.lang.slice(0, 10),
    level: b.level.slice(0, 10),
    slug: b.slug.slice(0, 200),
    sentIdx: Math.max(0, Math.floor(b.sentIdx)),
    savedAt: Math.floor(b.savedAt),
    deletedAt: typeof b.deletedAt === "number" ? Math.floor(b.deletedAt) : undefined,
    updatedAt: typeof b.updatedAt === "number" ? Math.floor(b.updatedAt) : Math.floor(b.savedAt),
  };
}

function sanitizeProgress(v: unknown): ProgressRecord | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Partial<ProgressRecord>;
  if (
    typeof r.lang !== "string" || typeof r.level !== "string" || typeof r.slug !== "string" ||
    typeof r.lastIdx !== "number" || typeof r.maxIdx !== "number" ||
    typeof r.total !== "number" || typeof r.updatedAt !== "number"
  ) return null;
  const total = Math.max(1, Math.floor(r.total));
  return {
    lang: r.lang.slice(0, 10),
    level: r.level.slice(0, 10),
    slug: r.slug.slice(0, 200),
    lastIdx: Math.min(Math.max(0, Math.floor(r.lastIdx)), total - 1),
    maxIdx: Math.min(Math.max(0, Math.floor(r.maxIdx)), total - 1),
    total,
    completedAt: typeof r.completedAt === "number" ? Math.floor(r.completedAt) : undefined,
    updatedAt: Math.floor(r.updatedAt),
  };
}

/** Upsert bookmarks by id; rows that lost a wordKey merge are deleted. */
async function syncBookmarks(database: Db, userId: string, incoming: SyncBookmark[]) {
  const existingRows = await database
    .select()
    .from(bookmarksTable)
    .where(eq(bookmarksTable.userId, userId));
  const existingById = new Map(existingRows.map((r) => [r.id, r]));

  // Same pure merge the client runs — identical conflict semantics.
  const merged = mergeBookmarks(
    incoming,
    existingRows.map(rowToBookmark)
  );

  const keptIds = new Set(merged.map((b) => b.id));
  // Delete rows whose id did not survive the merge (a newer duplicate on
  // another device replaced them) and tombstones older than 30 days (the
  // client prunes them on adopt, so the server must too — otherwise dead
  // rows accumulate forever and resurrect on every merge).
  const staleCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const doomed = existingRows
    .filter(
      (r) =>
        !keptIds.has(r.id) ||
        (r.deletedAt !== null && r.deletedAt < staleCutoff)
    )
    .map((r) => r.id);
  if (doomed.length) {
    await database.delete(bookmarksTable).where(
      and(eq(bookmarksTable.userId, userId), inArray(bookmarksTable.id, doomed))
    );
  }

  for (const b of merged) {
    const values = {
      id: b.id,
      userId,
      lang: b.lang,
      level: b.level,
      slug: b.slug,
      sentIdx: b.sentIdx,
      word: b.word,
      wordKey: `${b.lang}/${b.level}/${b.slug}/${b.sentIdx}/${b.word.toLowerCase()}`,
      note: b.note ?? "",
      englishMeaning: b.englishMeaning ?? null,
      reading: b.reading ?? null,
      romaji: b.romaji ?? null,
      context: b.context ?? "",
      contextEn: b.contextEn ?? "",
      savedAt: b.savedAt,
      deletedAt: b.deletedAt ?? null,
      updatedAt: b.updatedAt ?? b.savedAt,
    };
    const prev = existingById.get(b.id);
    if (
      prev &&
      prev.savedAt === values.savedAt &&
      (prev.deletedAt ?? null) === values.deletedAt &&
      prev.word === values.word
    ) {
      continue; // unchanged — skip the write
    }
    await database
      .insert(bookmarksTable)
      .values(values)
      .onConflictDoUpdate({ target: bookmarksTable.id, set: values });
  }
  return merged;
}

/** Upsert progress rows (composite key user+story), LWW already applied. */
async function syncProgress(database: Db, userId: string, incoming: ProgressRecord[]) {
  const existingRows = await database
    .select()
    .from(progressTable)
    .where(eq(progressTable.userId, userId));
  const existingMap: ProgressMap = {};
  for (const r of existingRows) {
    existingMap[`${r.lang}/${r.level}/${r.slug}`] = {
      lang: r.lang,
      level: r.level,
      slug: r.slug,
      lastIdx: r.lastIdx,
      maxIdx: r.maxIdx,
      total: r.total,
      completedAt: r.completedAt ?? undefined,
      updatedAt: r.updatedAt,
    };
  }
  const merged = mergeProgressMap(existingMap, incoming);

  const existingByKey = new Map(
    existingRows.map((r) => [`${r.lang}/${r.level}/${r.slug}`, r])
  );
  for (const rec of Object.values(merged)) {
    const values = {
      userId,
      lang: rec.lang,
      level: rec.level,
      slug: rec.slug,
      lastIdx: rec.lastIdx,
      maxIdx: rec.maxIdx,
      total: rec.total,
      completedAt: rec.completedAt ?? null,
      updatedAt: rec.updatedAt,
    };
    const prev = existingByKey.get(`${rec.lang}/${rec.level}/${rec.slug}`);
    if (prev && prev.updatedAt === rec.updatedAt) continue; // unchanged
    await database
      .insert(progressTable)
      .values(values)
      .onConflictDoUpdate({
        target: [progressTable.userId, progressTable.lang, progressTable.level, progressTable.slug],
        set: values,
      });
  }
  return Object.values(merged);
}

export async function POST(req: Request) {
  if (!db) {
    return Response.json({ error: "sync not configured" }, { status: 503 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const raw = body as Partial<SyncRequest>;
  const inBookmarks = Array.isArray(raw.bookmarks)
    ? raw.bookmarks
        .slice(0, MAX_BOOKMARKS_IN)
        .map(sanitizeBookmark)
        .filter((b): b is SyncBookmark => b !== null)
    : [];
  const inProgress = Array.isArray(raw.progress)
    ? raw.progress
        .slice(0, MAX_PROGRESS_IN)
        .map(sanitizeProgress)
        .filter((r): r is ProgressRecord => r !== null)
    : [];

  // The session user id comes from the JWT (set in auth.ts callbacks);
  // belt-and-braces: the row must exist.
  const userRow = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!userRow) {
    return Response.json({ error: "unknown user" }, { status: 401 });
  }

  const bookmarks = await syncBookmarks(db, userId, inBookmarks);
  const progress = await syncProgress(db, userId, inProgress);

  const response: SyncResponse = { bookmarks, progress };
  return Response.json(response);
}
