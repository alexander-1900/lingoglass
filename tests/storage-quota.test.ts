import { beforeEach, describe, expect, it } from "vitest";

// These paths only exist when `window.localStorage` is present (the stores
// are memory-only pass-throughs without it, which is what the rest of the
// suite exercises). Provide a mock BEFORE the store modules are exercised.
const store = new Map<string, string>();
/** When set, setItem throws for payloads longer than this (quota sim). */
let quotaLimit = Infinity;

const localStorageMock = {
  getItem(key: string): string | null {
    return store.has(key) ? store.get(key)! : null;
  },
  setItem(key: string, value: string): void {
    if (value.length > quotaLimit) {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    }
    store.set(key, value);
  },
  removeItem(key: string): void {
    store.delete(key);
  },
};

(globalThis as unknown as { window: unknown }).window = {
  localStorage: localStorageMock,
  addEventListener: () => {},
  removeEventListener: () => {},
};

import { addBookmark } from "../lib/bookmarks";
import { getProgress, progressKey, setProgress } from "../lib/progress";

const PROG_KEY = "lingoglass:progress";

function rec(i: number) {
  return {
    lang: "es",
    level: "a1",
    slug: `story-${i}`,
    lastIdx: i,
    maxIdx: i,
    total: 10,
    updatedAt: 1000 + i,
  };
}

beforeEach(() => {
  store.clear();
  quotaLimit = Infinity;
});

describe("progress quota trim", () => {
  it("shrinks the payload until the write fits (old code rewrote identical data and stalled)", () => {
    for (let i = 0; i < 13; i += 1) {
      quotaLimit = Infinity;
      expect(setProgress(rec(i))).toBe(true);
    }
    const storedBefore = store.get(PROG_KEY)!;
    // Anything bigger than the current payload fails; smaller must fit.
    quotaLimit = storedBefore.length;

    const ok = setProgress(rec(99)); // one more record -> over quota -> trim
    expect(ok).toBe(true);
    const stored = store.get(PROG_KEY)!;
    expect(stored.length).toBeLessThan(storedBefore.length);
    // The new record survives the trim (it's the newest).
    expect(getProgress(progressKey("es", "a1", "story-99"))?.lastIdx).toBe(99);
  });

  it("reports failure when even the empty map cannot be stored, keeping memory == disk", () => {
    expect(setProgress(rec(1))).toBe(true);
    const before = getProgress(progressKey("es", "a1", "story-1"));

    quotaLimit = 0; // nothing fits, not even "{}"
    expect(setProgress(rec(2))).toBe(false);

    // Failed write must not move memory: the older record is still the truth.
    expect(getProgress(progressKey("es", "a1", "story-1"))).toEqual(before);
    expect(getProgress(progressKey("es", "a1", "story-2"))).toBeUndefined();
  });
});

describe("bookmark writes", () => {
  const row = {
    word: "Hola",
    note: "",
    context: "Hola mundo.",
    contextEn: "Hello world.",
    lang: "es",
    level: "a1",
    slug: "s1",
    sentIdx: 0,
  };
  const otherTabRow = {
    word: "Adios",
    note: "",
    context: "Adios.",
    contextEn: "Bye.",
    lang: "es",
    level: "a1",
    slug: "s1",
    sentIdx: 1,
  };
  const BOOKMARKS_KEY = "lingoglass:bookmarks";

  it("returns failed on a full store and does not report a save", () => {
    quotaLimit = 0;
    expect(addBookmark(row)).toBe("failed");
    expect(store.has(BOOKMARKS_KEY)).toBe(false);
  });

  it("dup-checks against DISK, so a write from another tab is never stored twice", () => {
    expect(addBookmark(row)).toBe("saved");
    // Another tab saved `otherTabRow`; this tab's cache never saw it.
    const fromOtherTab = [
      { ...row, id: "a", savedAt: 1 },
      { ...otherTabRow, id: "b", savedAt: 2 },
    ];
    store.set(BOOKMARKS_KEY, JSON.stringify(fromOtherTab));

    // Old code: dup-checked the stale in-memory list, then built the new
    // list from disk -> two copies of "Adios".
    expect(addBookmark(otherTabRow)).toBe("duplicate");
    const stored = JSON.parse(store.get(BOOKMARKS_KEY)!) as { word: string }[];
    expect(stored.filter((b) => b.word === "Adios")).toHaveLength(1);
  });
});
