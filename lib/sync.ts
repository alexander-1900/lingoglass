import { isBookmarked, type Bookmark } from "./bookmarks";
import type { ProgressMap, ProgressRecord, SyncBookmark, SyncResponse } from "./sync-types";

/**
 * Client sync engine. Pure merge functions are exported separately (tested
 * in tests/sync.test.ts); the network parts are client-only no-ops without
 * a session, so anonymous users never pay a request.
 */

/** Lowercase dedupe key — mirrors lib/bookmarks.ts dedupeKey semantics. */
function wordKey(b: Pick<Bookmark, "lang" | "level" | "slug" | "sentIdx" | "word">): string {
  return `${b.lang}/${b.level}/${b.slug}/${b.sentIdx}/${b.word.toLowerCase()}`;
}

/**
 * Union by identity; conflict → later `savedAt` wins; a tombstone with the
 * newest `deletedAt` removes live rows (deletion propagates both ways).
 */
export function mergeBookmarks(local: SyncBookmark[], server: SyncBookmark[]): SyncBookmark[] {
  const byKey = new Map<string, SyncBookmark>();
  for (const b of [...local, ...server]) {
    const k = wordKey(b);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...b });
      continue;
    }
    // Same identity: keep the newer savedAt. On a savedAt tie the tombstone
    // wins so a deletion propagates instead of losing a coin flip on order.
    // A re-add (newer savedAt) after a delete revives the row: the tombstone
    // only survives when the deletion is newer than the winning save.
    const delA = prev.deletedAt ?? 0;
    const delB = b.deletedAt ?? 0;
    const newer =
      b.savedAt !== prev.savedAt
        ? b.savedAt > prev.savedAt
          ? b
          : prev
        : delB >= delA
          ? b
          : prev;
    const newestDeletion = Math.max(delA, delB);
    byKey.set(k, {
      ...newer,
      deletedAt:
        newestDeletion > newer.savedAt ? newestDeletion : newer.deletedAt ?? undefined,
    });
  }
  // Stable order: newest first (matches addBookmark's prepend order).
  return [...byKey.values()].sort((a, b) => b.savedAt - a.savedAt);
}

/** LWW by updatedAt; clamp lastIdx into [0, total-1] for story edits. */
export function mergeProgressMap(
  local: ProgressMap,
  server: ProgressRecord[]
): ProgressMap {
  const out: ProgressMap = { ...local };
  for (const rec of server) {
    const key = `${rec.lang}/${rec.level}/${rec.slug}`;
    const prev = out[key];
    if (!prev || rec.updatedAt > prev.updatedAt) {
      const total = Math.max(1, rec.total || prev?.total || 1);
      out[key] = {
        ...rec,
        lastIdx: Math.min(Math.max(0, rec.lastIdx), total - 1),
        maxIdx: Math.min(Math.max(0, rec.maxIdx), total - 1),
      };
    }
  }
  return out;
}

// --- client-only engine -----------------------------------------------------

let syncTimer: number | undefined;
let syncing = false;
let pending = false;

/** Is a sync-capable session present? (cached promise, cheap) */
let sessionCache: { at: number; hasSession: boolean } | null = null;
async function hasSession(): Promise<boolean> {
  const now = Date.now();
  if (sessionCache && now - sessionCache.at < 60_000) return sessionCache.hasSession;
  try {
    const res = await fetch("/api/auth/session");
    const data = (await res.json()) as unknown;
    const has = typeof data === "object" && data !== null && "user" in data;
    sessionCache = { at: now, hasSession: has };
    return has;
  } catch {
    sessionCache = { at: now, hasSession: false };
    return false;
  }
}

/** Full-state sync: send everything, adopt the merged response. */
export async function syncNow(): Promise<SyncResponse | null> {
  if (typeof window === "undefined") return null;
  if (syncing) {
    pending = true;
    return null;
  }
  if (!(await hasSession())) return null;
  syncing = true;
  try {
    const { getLocalBookmarks } = await import("./bookmarks");
    const { getProgressRaw } = await import("./progress");
    const body: import("./sync-types").SyncRequest = {
      bookmarks: getLocalBookmarks(),
      progress: Object.values(getProgressRaw()),
    };
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const merged = (await res.json()) as SyncResponse;
    const { adoptBookmarks } = await import("./bookmarks");
    const { adoptProgress } = await import("./progress");
    adoptBookmarks(merged.bookmarks);
    adoptProgress(merged.progress);
    return merged;
  } catch {
    return null; // offline — local state stays authoritative until next sync
  } finally {
    syncing = false;
    if (pending) {
      pending = false;
      scheduleSync();
    }
  }
}

/** Debounced background sync after local changes (2s). */
export function scheduleSync(): void {
  if (typeof window === "undefined") return;
  if (syncTimer !== undefined) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = undefined;
    void syncNow();
  }, 2000);
}

/**
 * One-shot full merge on login: pull the server state, merge into local,
 * push the union. Resolves when the local stores have adopted the result.
 */
export async function mergeOnLogin(): Promise<void> {
  await syncNow();
}

export { isBookmarked };