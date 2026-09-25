"use client";

import { useSyncExternalStore } from "react";

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
  /**
   * Legacy sync tombstone (pre-auth-removal). No longer written; old rows
   * carrying it are purged on read (see migration in read()).
   */
  deletedAt?: number;
}

type NewBookmark = Omit<Bookmark, "id" | "savedAt">;

const KEY = "lingoglass:bookmarks";

let cache: Bookmark[] | null = null;
const listeners = new Set<() => void>();

/**
 * Pure sanitation of a parsed localStorage payload: keeps only rows that are
 * safe to render and index. Requires the full identity tuple — AppShell does
 * `b.level.toUpperCase()` during render, so a legacy/corrupt row without
 * `level` used to take down the WHOLE app (AppShell wraps every page).
 * Also drops legacy sync tombstones (`deletedAt`).
 */
export function sanitizeBookmarks(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is Bookmark =>
      typeof b === "object" &&
      b !== null &&
      typeof (b as Bookmark).id === "string" &&
      typeof (b as Bookmark).word === "string" &&
      typeof (b as Bookmark).lang === "string" &&
      typeof (b as Bookmark).level === "string" &&
      typeof (b as Bookmark).slug === "string" &&
      typeof (b as Bookmark).sentIdx === "number" &&
      !(b as Bookmark).deletedAt
  );
}

function read(): Bookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const live = sanitizeBookmarks(parsed);
    // One-time migration: if invalid rows / legacy tombstones were dropped,
    // persist the cleaned list so they don't linger on disk.
    if (Array.isArray(parsed) && live.length !== parsed.length) {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(live));
      } catch {
        /* ignore — next read migrates again */
      }
    }
    return live;
  } catch {
    return [];
  }
}

/** Persist the queue. Returns what was ACTUALLY stored: `ok: false` means
 *  nothing landed (caller surfaces the failure); a `storedCount` below
 *  `next.length` means the quota fallback dropped the oldest entries — the
 *  caller must NOT report a plain "saved" for that. */
function write(next: Bookmark[]): { ok: boolean; storedCount: number } {
  if (typeof window === "undefined") return { ok: false, storedCount: 0 };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return { ok: true, storedCount: next.length };
  } catch {
    // Quota exceeded (or private mode): drop the oldest half and retry once,
    // so a heavy session degrades gracefully instead of losing all saves.
    if (next.length > 20) {
      try {
        const trimmed = next.slice(0, Math.ceil(next.length / 2));
        window.localStorage.setItem(KEY, JSON.stringify(trimmed));
        return { ok: true, storedCount: trimmed.length };
      } catch {
        /* still over quota — give up, caller surfaces the failure */
      }
    }
    return { ok: false, storedCount: 0 };
  }
}

function refresh(): Bookmark[] {
  cache = read();
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
  return cache ?? refresh();
}

function serverSnapshot(): Bookmark[] {
  return [];
}

export function useBookmarks(): Bookmark[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
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
type AddResult = "saved" | "duplicate" | "failed" | "trimmed";

/** localStorage safety cap — oldest entries dropped first (LRU). */
const MAX_BOOKMARKS = 500;

/** Save a word; "duplicate" when already bookmarked, "failed" when storage is full,
 *  "trimmed" when it was stored but the quota fallback dropped older entries. */
export function addBookmark(b: NewBookmark): AddResult {
  const now = Date.now();
  const current = cache ?? refresh();
  if (isBookmarked(current, b)) {
    return "duplicate";
  }
  const entry: Bookmark = {
    ...b,
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: now,
  };
  // Cap the queue so one heavy session can't fill the ~5MB localStorage
  // quota and silently break every future save.
  const next = [entry, ...read()].slice(0, MAX_BOOKMARKS);
  const result = write(next);
  emit();
  if (!result.ok) return "failed";
  return result.storedCount < next.length ? "trimmed" : "saved";
}

/** Remove a word (local-only hard delete). */
export function removeBookmark(id: string): void {
  const next = read().filter((b) => b.id !== id);
  write(next);
  emit();
}
