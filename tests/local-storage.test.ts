import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { isBookmarked, sanitizeBookmarks } from "../lib/bookmarks";
import { getProgress, progressKey, setProgress } from "../lib/progress";
import { getStoriesForLevel } from "../lib/stories";

describe("local-only stores", () => {
  it("drops corrupt rows that would crash the sidebar (missing level/lang/slug)", () => {
    const rows = [
      // valid row
      { id: "1", word: "Hola", lang: "es", level: "a1", slug: "s", sentIdx: 0, savedAt: 1 },
      // missing lang/level/slug — AppShell calls b.level.toUpperCase() on render
      { id: "2", word: "x" },
      // missing sentIdx
      { id: "3", word: "y", lang: "es", level: "a1", slug: "s" },
      // legacy sync tombstone
      { id: "4", word: "z", lang: "es", level: "a1", slug: "s", sentIdx: 0, deletedAt: 9 },
      // wrong types / non-objects
      { id: 5, word: 123 },
      "junk",
      null,
    ];
    const out = sanitizeBookmarks(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("1");
    expect(sanitizeBookmarks("not-an-array")).toEqual([]);
    expect(sanitizeBookmarks(undefined)).toEqual([]);
  });

  it("dedupes bookmarks case-insensitively on identity", () => {
    const list = [
      {
        id: "a",
        word: "Hola",
        note: "",
        context: "",
        contextEn: "",
        lang: "es",
        level: "a1",
        slug: "s",
        sentIdx: 0,
        savedAt: 1,
      },
    ];
    expect(
      isBookmarked(list, { lang: "es", level: "a1", slug: "s", sentIdx: 0, word: "hola" })
    ).toBe(true);
    expect(
      isBookmarked(list, { lang: "es", level: "a1", slug: "s", sentIdx: 1, word: "hola" })
    ).toBe(false);
  });

  it("builds stable progress keys", () => {
    expect(progressKey("es", "a1", "s")).toBe("es/a1/s");
  });

  it("ignores stale progress writes but accepts newer ones", () => {
    const key = progressKey("es", "a9", "stale-guard-probe");
    setProgress({ lang: "es", level: "a9", slug: "stale-guard-probe", lastIdx: 5, maxIdx: 5, total: 10, updatedAt: 1000 });
    setProgress({ lang: "es", level: "a9", slug: "stale-guard-probe", lastIdx: 1, maxIdx: 1, total: 10, updatedAt: 500 });
    expect(getProgress(key)?.lastIdx).toBe(5);
    setProgress({ lang: "es", level: "a9", slug: "stale-guard-probe", lastIdx: 7, maxIdx: 7, total: 10, updatedAt: 1500 });
    expect(getProgress(key)?.lastIdx).toBe(7);
  });
});

describe("story loader", () => {
  it("loads known levels and skips unknown ones without throwing", () => {
    const esA1 = getStoriesForLevel("es", "a1");
    expect(esA1.length).toBeGreaterThan(0);
    for (const s of esA1) expect(s.title.length).toBeGreaterThan(0);
    expect(getStoriesForLevel("es", "xx-no-such-level")).toEqual([]);
  });
});

describe("ja tokens artifact", () => {
  it("is committed, non-fallback, and covers a known story", () => {
    const file = path.join(process.cwd(), "data", "ja-tokens.generated.json");
    expect(fs.existsSync(file)).toBe(true);
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      signature: string;
      fallback?: boolean;
      stories: Record<string, unknown[][]>;
    };
    expect(data.signature).toBeTruthy();
    expect(data.fallback).not.toBe(true);
    const keys = Object.keys(data.stories);
    expect(keys.length).toBeGreaterThan(0);
    expect(data.stories["ja/n5/01-momotaro"]?.length).toBeGreaterThan(0);
  });
});
