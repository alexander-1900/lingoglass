import { describe, expect, it } from "vitest";
import { tokenWithRomaji } from "../lib/furigana-romaji";
import type { Token } from "../lib/types";

/**
 * Regression tests for the JA romaji derivation (client-side, over the
 * committed Sudachi artifact).
 *
 * Pre-fix, 127 committed readings ending in the sokuon fell through to the
 * raw-glyph path and rendered as "komoッ" / "yokotawaッ" in the romaji line,
 * and 593 punctuation tokens (、。「」・) got a fabricated romaji that printed a
 * duplicate glyph under the word.
 *
 * Known limitation (pre-existing, unchanged): sokuon before a small yō is
 * approximate — キョット derives "kiyotto" rather than a geminated "kyotto".
 */

function romajiOf(reading: string): string | undefined {
  return tokenWithRomaji({ surface: "x", reading }).romaji;
}

function keysOf(token: Token): string[] {
  return Object.keys(token);
}

describe("kana → romaji", () => {
  it("maps long vowels, gemination and digraphs", () => {
    expect(romajiOf("コーヒー")).toBe("koohii");
    expect(romajiOf("ラーメン")).toBe("raamen");
    expect(romajiOf("ガッコウ")).toBe("gakkou");
    expect(romajiOf("シュッパツ")).toBe("shuppatsu"); // mid-word sokuon kept
    expect(romajiOf("チャ")).toBe("cha");
    expect(romajiOf("ニホンゴ")).toBe("nihongo");
  });

  it("drops a trailing sokuon instead of emitting the raw glyph", () => {
    expect(romajiOf("コモッ")).toBe("komo"); // was "komoッ"
    expect(romajiOf("イッ")).toBe("i"); // was "iッ"
    expect(romajiOf("ヨコタワッ")).toBe("yokotawa"); // was "yokotawaッ"
    expect(romajiOf("アッ")).toBe("a");
    expect(romajiOf("ッ")).toBeUndefined(); // nothing left to transliterate
  });

  it("maps rare kana so no raw glyph can leak into the romaji line", () => {
    expect(romajiOf("クヷ")).toBe("kuva");
    for (const reading of ["ヷ", "ヸ", "ヹ", "ヺ", "ヮ", "ヰ", "ヱ"]) {
      const out = romajiOf(reading) ?? "";
      // eslint-disable-next-line no-control-regex
      expect(out).toMatch(/^[\x20-\x7E]*$/);
    }
  });

  it("never produces non-ASCII romaji", () => {
    for (const reading of ["コーヒー", "ッ", "ー", "・", "。", "！？", "キョット"]) {
      const out = romajiOf(reading) ?? "";
      // eslint-disable-next-line no-control-regex
      expect(out).toMatch(/^[\x20-\x7E]*$/);
    }
  });
});

describe("tokenWithRomaji and non-word readings", () => {
  it("attaches nothing for punctuation or ASCII readings", () => {
    // Sudachi reports punctuation tokens with the glyph itself as reading.
    for (const reading of ["、", "。", "「", "」", "・", "！", "?", "…", "123", "_ABC"]) {
      expect(tokenWithRomaji({ surface: reading, reading }).romaji).toBeUndefined();
    }
  });

  it("returns the same object shape when no romaji can be derived", () => {
    const t: Token = { surface: "。", reading: "。", lemma: "。" };
    expect(keysOf(tokenWithRomaji(t))).toEqual(["surface", "reading", "lemma"]);
    expect(tokenWithRomaji(t)).toBe(t); // untouched — no hidden "" field
  });

  it("keeps reading/lemma and adds romaji for real words", () => {
    expect(tokenWithRomaji({ surface: "食べ", reading: "タベ", lemma: "食べる" })).toEqual({
      surface: "食べ",
      reading: "タベ",
      lemma: "食べる",
      romaji: "tabe",
    });
  });

  it("handles hiragana readings via the katakana fallback", () => {
    expect(romajiOf("たべ")).toBe("tabe");
    expect(romajiOf("がっこう")).toBe("gakkou");
    expect(romajiOf("こーひー")).toBe("koohii");
  });

  it("passes tokens without a reading straight through", () => {
    const t: Token = { surface: "x" };
    expect(tokenWithRomaji(t)).toBe(t);
  });
});
