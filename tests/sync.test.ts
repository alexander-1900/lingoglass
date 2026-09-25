import { describe, expect, it } from "vitest";
import { mergeBookmarks, mergeProgressMap } from "../lib/sync";
import type { ProgressMap } from "../lib/sync-types";

function bm(over: Record<string, unknown> = {}): import("../lib/sync-types").SyncBookmark {
  return {
    id: "id-1",
    word: "hola",
    note: "n",
    context: "c",
    contextEn: "ce",
    lang: "es",
    level: "a1",
    slug: "s",
    sentIdx: 0,
    savedAt: 1000,
    ...over,
  } as import("../lib/sync-types").SyncBookmark;
}

describe("mergeBookmarks", () => {
  it("unions distinct words from both sides", () => {
    const local = [bm({ id: "a", word: "hola", savedAt: 100 })];
    const server = [bm({ id: "b", word: "adios", savedAt: 200 })];
    const out = mergeBookmarks(local, server);
    expect(out.map((b) => b.word).sort()).toEqual(["adios", "hola"]);
  });

  it("dedupes the same identity, newer savedAt wins", () => {
    const local = [bm({ id: "a", word: "HOLA", note: "local", savedAt: 100 })];
    const server = [bm({ id: "b", word: "hola", note: "server", savedAt: 200 })];
    const out = mergeBookmarks(local, server);
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe("server");
  });

  it("a tombstone newer than the live save wins (deletion propagates)", () => {
    const local = [bm({ id: "a", savedAt: 100 })];
    const server = [bm({ id: "b", savedAt: 100, deletedAt: 200 })];
    const out = mergeBookmarks(local, server);
    expect(out).toHaveLength(1);
    expect(out[0].deletedAt).toBe(200);
  });

  it("re-adding after a delete revives the row (newer savedAt clears the tombstone)", () => {
    const local = [bm({ id: "b", savedAt: 300 })];
    const server = [bm({ id: "a", savedAt: 100, deletedAt: 200 })];
    const out = mergeBookmarks(local, server);
    expect(out).toHaveLength(1);
    expect(out[0].deletedAt).toBeUndefined();
    expect(out[0].id).toBe("b");
  });

  it("sorts newest-first like the local prepend order", () => {
    const out = mergeBookmarks(
      [bm({ id: "a", word: "aaa", savedAt: 50 })],
      [bm({ id: "b", word: "bbb", savedAt: 500 })]
    );
    expect(out[0].word).toBe("bbb");
  });
});

describe("mergeProgressMap", () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    lang: "es",
    level: "a1",
    slug: "s",
    lastIdx: 3,
    maxIdx: 5,
    total: 10,
    updatedAt: 100,
    ...over,
  });
  it("adopts newer server records, keeps newer local ones", () => {
    const local: ProgressMap = { "es/a1/s": rec({ lastIdx: 1, updatedAt: 200 }) };
    const outNew = mergeProgressMap(local, [rec({ lastIdx: 7, updatedAt: 100 })]);
    expect(outNew["es/a1/s"].lastIdx).toBe(1);
    const outOld = mergeProgressMap({ "es/a1/s": rec({ lastIdx: 1, updatedAt: 50 }) }, [
      rec({ lastIdx: 7, updatedAt: 100 }),
    ]);
    expect(outOld["es/a1/s"].lastIdx).toBe(7);
  });

  it("adds unknown server stories and clamps indices to total-1", () => {
    const out = mergeProgressMap({}, [rec({ lastIdx: 99, maxIdx: 99, total: 10, updatedAt: 5 })]);
    expect(out["es/a1/s"].lastIdx).toBe(9);
    expect(out["es/a1/s"].maxIdx).toBe(9);
  });
});
