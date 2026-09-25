"use client";

import { useSyncExternalStore } from "react";
import { scheduleSync } from "./sync";

export interface Bookmark {
  id: string;
  /** Word exactly as displayed/tapped in the story. */
  word: string;
  /** Story-authored gloss note (from the `* word (note)` lines), if any. */
  note: string;
  /** English meaning from the local JMdict lookup (Japanese words). */
  englishMeaning?: string;
  /** Katakana/kana reading (Sudachi), when tokenized. */
  reading?: string;
  /** Romaji rendering of the reading, when tokenized. */
  romaji?: string;
  /** The target-language sentence the word was saved from. */
  context: string;
  /** English translation of that sentence (sentence translation). */
  contextEn: string;
  lang: string;
  level: string;
  slug: string;
  sentIdx: number;
  savedAt: number;
  /** Sync tombstone: set when removed, so the deletion propagates to other
   *  devices instead of resurfacing on the next full-state merge. */
  deletedAt?: number;
  /** Mutation timestamp (epoch ms) used by sync when savedAt isn't enough. */
  updatedAt?: number;
}

export type NewBookmark = Omit<Bookmark, "id" | "savedAt">;

const KEY = "lingoglass:bookmarks";

let cache: Bookmark[] | null = null;
let liveCache: Bookmark[] = [];
const listeners = new Set<() => void>();

function read(): Bookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b): b is Bookmark =>
        typeof b === "object" &&
        b !== null &&
        typeof (b as Bookmark).word === "string" &&
        typeof (b as Bookmark).id === "string"
    );
  } catch {
    return [];
  }
}

function write(next: Bookmark[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return true;
  } catch {
    // Quota exceeded (or private mode): drop the oldest half and retry once,
    // so a heavy session degrades gracefully instead of losing all saves.
    if (next.length > 20) {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next.slice(0, Math.ceil(next.length / 2))));
        return true;
      } catch {
        /* still over quota — give up, caller surfaces the failure */
      }
    }
    return false;
  }
}

function refresh(): Bookmark[] {
  cache = read();
  // Two views of the same data: the raw list (tombstones included) drives
  // sync, while the hook only exposes live rows.
  liveCache = cache.filter((b) => !b.deletedAt);
  return cache;
}

function emit(): void {
  refresh();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function snapshot(): Bookmark[] {
  if (cache === null) refresh();
  return liveCache;
}

function serverSnapshot(): Bookmark[] {
  return [];
}

export function useBookmarks(): Bookmark[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Raw store contents including tombstones — what the sync engine sends. */
export function getLocalBookmarks(): Bookmark[] {
  return cache ?? refresh();
}

/** Replace local state with the merged server response (adopt after sync). */
export function adoptBookmarks(list: Bookmark[]): void {
  const now = Date.now();
  // Drop stale tombstones (>30 days) and cap like addBookmark does.
  const pruned = list
    .filter((b) => !b.deletedAt || now - b.deletedAt < 30 * 24 * 60 * 60 * 1000)
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_BOOKMARKS);
  cache = pruned;
  liveCache = pruned.filter((b) => !b.deletedAt);
  write(pruned);
  listeners.forEach((l) => l());
}

function dedupeKey(b: Pick<Bookmark, "lang" | "level" | "slug" | "sentIdx" | "word">): string {
  return `${b.lang}/${b.level}/${b.slug}/${b.sentIdx}/${b.word.toLowerCase()}`;
}

export function isBookmarked(
  list: Bookmark[],
  b: Pick<Bookmark, "lang" | "level" | "slug" | "sentIdx" | "word">
): boolean {
  const k = dedupeKey(b);
  return list.some((x) => dedupeKey(x) === k);
}

/** Outcome of a save attempt, so the UI can surface a full storage. */
export type AddResult = "saved" | "duplicate" | "failed";

/** localStorage safety cap — oldest entries dropped first (LRU). */
const MAX_BOOKMARKS = 500;

/** Save a word; "duplicate" when already bookmarked, "failed" when storage is full. */
export function addBookmark(b: NewBookmark): AddResult {
  const now = Date.now();
  // Dedupe against LIVE rows only: a tombstoned word can be re-added, which
  // revives it (new savedAt wins in the merge, deletedAt cleared).
  if (isBookmarked(getLocalBookmarks().filter((x) => !x.deletedAt), b)) {
    return "duplicate";
  }
  const entry: Bookmark = {
    ...b,
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: now,
    updatedAt: now,
  };
  // Cap the queue so one heavy session can't fill the ~5MB localStorage
  // quota and silently break every future save.
  const next = [entry, ...read()].slice(0, MAX_BOOKMARKS);
  const persisted = write(next);
  emit();
  if (persisted) scheduleSync();
  return persisted ? "saved" : "failed";
}

/** Remove a word. Tombstoned (not hard-deleted) so the removal syncs to
 *  the account and other devices instead of resurfacing on merge. */
export function removeBookmark(id: string): void {
  const now = Date.now();
  const next = read().map((b) =>
    b.id === id ? { ...b, deletedAt: now, updatedAt: now } : b
  );
  write(next);
  emit();
  scheduleSync();
}
