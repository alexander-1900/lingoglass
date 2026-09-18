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
}

export type NewBookmark = Omit<Bookmark, "id" | "savedAt">;

const KEY = "lingoglass:bookmarks";

let cache: Bookmark[] | null = null;
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

function write(next: Bookmark[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode etc. — bookmarks just don't persist */
  }
}

function emit(): void {
  cache = read();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function snapshot(): Bookmark[] {
  if (!cache) cache = read();
  return cache;
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

/** Save a word; returns false when it was already bookmarked. */
export function addBookmark(b: NewBookmark): boolean {
  const list = read();
  if (isBookmarked(list, b)) return false;
  const entry: Bookmark = {
    ...b,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
  };
  write([entry, ...list]);
  emit();
  return true;
}

export function removeBookmark(id: string): void {
  write(read().filter((b) => b.id !== id));
  emit();
}
