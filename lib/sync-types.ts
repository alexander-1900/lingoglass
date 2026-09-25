import type { Bookmark } from "./bookmarks";

/** Bookmark plus a tombstone marker for cross-device deletion. */
export interface SyncBookmark extends Bookmark {
  deletedAt?: number;
}

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
  /** Epoch ms — the last-write-wins field. */
  updatedAt: number;
}

export type ProgressMap = Record<string, ProgressRecord>;

export interface SyncRequest {
  bookmarks: SyncBookmark[];
  progress: ProgressRecord[];
}

export interface SyncResponse {
  bookmarks: SyncBookmark[];
  progress: ProgressRecord[];
}
