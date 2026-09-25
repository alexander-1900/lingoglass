"use client";

import { useSyncExternalStore } from "react";
import { scheduleSync } from "./sync";
import type { ProgressMap, ProgressRecord } from "./sync-types";

/**
 * Reading-position store — the local-first half of progress sync. Same
 * pattern as lib/bookmarks.ts: module singleton + useSyncExternalStore.
 * Writes land in localStorage immediately and schedule a debounced push.
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

function write(next: ProgressMap): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return true;
  } catch {
    // Quota exceeded: drop the oldest third (by updatedAt) and retry once.
    const entries = Object.entries(next)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
    const keep = entries.slice(0, Math.max(10, Math.floor(entries.length * 2 / 3)));
    try {
      window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)));
      return true;
    } catch {
      return false;
    }
  }
}

function refresh(): ProgressMap {
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

/** Raw map for the sync engine. */
export function getProgressRaw(): ProgressMap {
  return cache ?? refresh();
}

/** Upsert one story's position; emits + schedules a debounced sync. */
export function setProgress(rec: ProgressRecord): void {
  const key = progressKey(rec.lang, rec.level, rec.slug);
  const map = getProgressRaw();
  const prev = map[key];
  if (prev && prev.updatedAt >= rec.updatedAt) return; // stale write
  // LRU cap: drop the oldest stories when over the cap.
  const entries = Object.entries(map).sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
  const trimmed = entries.slice(0, MAX_PROGRESS - 1);
  const next: ProgressMap = Object.fromEntries([...trimmed, [key, rec]]);
  cache = next;
  if (write(next)) {
    listeners.forEach((l) => l());
    scheduleSync();
  }
}

/** Replace local state with the merged server response (adopt after sync).
 *  Does NOT schedule a follow-up sync — adopt is the END of a sync cycle. */
export function adoptProgress(records: ProgressRecord[]): void {
  const clean: ProgressMap = {};
  for (const rec of records) {
    if (isValidRecord(rec)) clean[progressKey(rec.lang, rec.level, rec.slug)] = rec;
  }
  cache = clean;
  if (write(clean)) {
    listeners.forEach((l) => l());
  }
}

/**
 * Pure LWW merge (exported for tests via lib/sync.ts mergeProgressMap —
 * this thin wrapper keeps the store's import surface small).
 */
import { mergeProgressMap } from "./sync";
export function mergeProgress(local: ProgressMap, server: ProgressRecord[]): ProgressMap {
  return mergeProgressMap(local, server);
}
