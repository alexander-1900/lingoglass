"use client";

import { useSyncExternalStore } from "react";

/** Per-story reading position. Identity key: `${lang}/${level}/${slug}` */
export interface ProgressRecord {
  lang: string;
  level: string;
  slug: string;
  /** Sentence index to resume from. */
  lastIdx: number;
  /** Furthest sentence reached — drives the progress percentage. */
  maxIdx: number;
  /** Snapshot of the story's sentence count at write time. */
  total: number;
  completedAt?: number;
  /** Epoch ms — orders writes (newer wins). */
  updatedAt: number;
}

type ProgressMap = Record<string, ProgressRecord>;

/**
 * Reading-position store — local-only. Module singleton +
 * useSyncExternalStore. Writes land in localStorage immediately.
 */

const KEY = "lingoglass:progress";
const MAX_PROGRESS = 200; // more stories than exist today (85); LRU guard

export function progressKey(lang: string, level: string, slug: string): string {
  return `${lang}/${level}/${slug}`;
}

let cache: ProgressMap | null = null;
const listeners = new Set<() => void>();

function read(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: ProgressMap = {};
    for (const [key, rec] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidRecord(rec)) out[key] = rec;
    }
    return out;
  } catch {
    return {};
  }
}

function isValidRecord(v: unknown): v is ProgressRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Partial<ProgressRecord>;
  return (
    typeof r.lang === "string" &&
    typeof r.level === "string" &&
    typeof r.slug === "string" &&
    typeof r.lastIdx === "number" &&
    typeof r.maxIdx === "number" &&
    typeof r.total === "number" &&
    typeof r.updatedAt === "number"
  );
}

/** Persist the map. Returns what was ACTUALLY stored (after quota trimming),
 *  or null when nothing landed. `window`-less environments (SSR / vitest) are
 *  memory-only pass-throughs: they return `next` unchanged so stores and
 *  tests keep working without localStorage. */
function write(next: ProgressMap): ProgressMap | null {
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    // Quota exceeded: drop the oldest third (by updatedAt) and retry once.
    const entries = Object.entries(next)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
    const keep = entries.slice(0, Math.max(10, Math.floor(entries.length * 2 / 3)));
    const trimmed = Object.fromEntries(keep);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch {
      return null;
    }
  }
}

function refresh(): ProgressMap {
  cache = read();
  return cache;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function snapshot(): ProgressMap {
  return cache ?? refresh();
}

function serverSnapshot(): ProgressMap {
  return {};
}

export function useProgress(): ProgressMap {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function getProgress(key: string): ProgressRecord | undefined {
  const map = cache ?? refresh();
  return map[key];
}

/** Upsert one story's position (local-only). */
export function setProgress(rec: ProgressRecord): void {
  const key = progressKey(rec.lang, rec.level, rec.slug);
  const map = cache ?? refresh();
  const prev = map[key];
  if (prev && prev.updatedAt > rec.updatedAt) return; // stale write
  // LRU cap: drop the oldest stories when over the cap.
  const entries = Object.entries(map).sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
  const trimmed = entries.slice(0, MAX_PROGRESS - 1);
  const next: ProgressMap = Object.fromEntries([...trimmed, [key, rec]]);
  // Only touch memory/notify for what ACTUALLY landed on disk — setting the
  // cache before a failed write made memory diverge from storage and the
  // position silently reverted on the next full read.
  const persisted = write(next);
  if (!persisted) return; // storage full: keep memory == disk (previous value)
  cache = persisted;
  listeners.forEach((l) => l());
}
