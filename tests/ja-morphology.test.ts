import { describe, expect, it } from "vitest";
import {
  affixCandidates,
  isContentPos,
  nextOccurrence,
  posLabel,
  resolveMeaning,
  tokenRole,
} from "../lib/ja-morphology";
import type { Token } from "../lib/types";

const tok = (surface: string, extra: Partial<Token> = {}): Token => ({
  surface,
  ...extra,
});

describe("posLabel", () => {
  it("maps Sudachi first-level POS tags to short English labels", () => {
    expect(posLabel("動詞,非自立可能,五段-ラ行")).toBe("verb");
    expect(posLabel("名詞,普通名詞,一般")).toBe("noun");
    expect(posLabel("助詞,格助詞,一般")).toBe("particle");
    expect(posLabel("助動詞,*")).toBe("auxiliary");
    expect(posLabel("接尾辞,名詞的")).toBe("suffix");
    expect(posLabel("接頭辞,*")).toBe("prefix");
    expect(posLabel("形状詞,一般")).toBe("adjective");
    expect(posLabel("連体詞,*")).toBe("determiner");
    expect(posLabel("代名詞,*")).toBe("pronoun");
  });

  it("reads a digit as a numeral, not as a noun", () => {
    expect(posLabel("名詞,数詞,数字")).toBe("numeral");
  });

  it("stays undefined when POS is unknown (regex-fallback tokens)", () => {
    expect(posLabel(undefined)).toBeUndefined();
    expect(posLabel("")).toBeUndefined();
  });
});

describe("isContentPos", () => {
  it("excludes particles and auxiliaries from the repeat highlight", () => {
    expect(isContentPos("助詞,接続助詞,一般")).toBe(false);
    expect(isContentPos("助動詞,*")).toBe(false);
  });

  it("includes content words and tokens without POS", () => {
    expect(isContentPos("名詞,普通名詞,一般")).toBe(true);
    expect(isContentPos("動詞,非自立可能,五段-ワ行")).toBe(true);
    expect(isContentPos(undefined)).toBe(true);
  });
});

describe("nextOccurrence", () => {
  it("counts repeats of one word from 0, independent of other words", () => {
    const seen = new Map<string, number>();
    expect(nextOccurrence(seen, "桃")).toBe(0);
    expect(nextOccurrence(seen, "桃")).toBe(1);
    expect(nextOccurrence(seen, "桃")).toBe(2);
    expect(nextOccurrence(seen, "猿")).toBe(0);
  });
});

describe("tokenRole", () => {
  const open = { word: "桃", sentIdx: 1, occ: 0 };
  const noun = "名詞,普通名詞,一般";

  it("gives the card to exactly ONE occurrence", () => {
    expect(tokenRole(open, { word: "桃", sentIdx: 1, occ: 0 }, noun)).toBe("tapped");
    expect(tokenRole(open, { word: "桃", sentIdx: 1, occ: 1 }, noun)).toBe("repeat");
    expect(tokenRole(open, { word: "桃", sentIdx: 3, occ: 0 }, noun)).toBe("repeat");
  });

  it("ignores other words and a closed card", () => {
    expect(tokenRole(open, { word: "猿", sentIdx: 1, occ: 0 }, noun)).toBeNull();
    expect(tokenRole(null, { word: "桃", sentIdx: 1, occ: 0 }, noun)).toBeNull();
    expect(tokenRole(undefined, { word: "桃", sentIdx: 1, occ: 0 }, noun)).toBeNull();
  });

  it("never lights up function words (た/て would tint the whole story)", () => {
    const aux = "助動詞,*";
    // The tapped occurrence still owns its card…
    expect(tokenRole({ word: "た", sentIdx: 0, occ: 0 }, { word: "た", sentIdx: 0, occ: 0 }, aux)).toBe("tapped");
    // …but other occurrences stay unhighlighted.
    expect(tokenRole({ word: "た", sentIdx: 0, occ: 0 }, { word: "た", sentIdx: 4, occ: 2 }, aux)).toBeNull();
    expect(tokenRole({ word: "て", sentIdx: 0, occ: 0 }, { word: "て", sentIdx: 2, occ: 1 }, "助詞,接続助詞,一般")).toBeNull();
  });
});

describe("affixCandidates", () => {
  it("rebuilds the host word of a split suffix (じい + さん)", () => {
    const tokens = [tok("じい", { pos: "名詞,普通名詞" }), tok("さん", { pos: "接尾辞,名詞的" })];
    expect(affixCandidates(tokens, 1).map((c) => c.surface)).toEqual(["じいさん"]);
  });

  it("rebuilds prefix + stem + suffix (お + じい + さん), longest first", () => {
    const tokens = [
      tok("お", { pos: "接頭辞,名詞的" }),
      tok("じい", { pos: "名詞,普通名詞" }),
      tok("さん", { pos: "接尾辞,名詞的" }),
    ];
    expect(affixCandidates(tokens, 2).map((c) => c.surface)).toEqual(["おじいさん", "じいさん"]);
    expect(affixCandidates(tokens, 0).map((c) => c.surface)).toEqual(["おじいさん", "おじい"]);
  });

  it("concatenates readings when every part has one", () => {
    const tokens = [
      tok("お", { pos: "接頭辞,名詞的", reading: "オ" }),
      tok("じい", { pos: "名詞,普通名詞", reading: "ジイ" }),
      tok("さん", { pos: "接尾辞,名詞的", reading: "サン" }),
    ];
    expect(affixCandidates(tokens, 2)[0].reading).toBe("オジイサン");
  });

  it("leaves plain words alone and refuses to merge across punctuation", () => {
    expect(affixCandidates([tok("桃", { pos: "名詞,普通名詞" })], 0)).toEqual([]);
    const split = [tok("、", { pos: "補助記号,読点" }), tok("さん", { pos: "接尾辞,名詞的" })];
    expect(affixCandidates(split, 1)).toEqual([]);
  });

  it("returns nothing for tokens without POS or out of range", () => {
    expect(affixCandidates([tok("さん")], 0)).toEqual([]);
    expect(affixCandidates([], 0)).toEqual([]);
  });
});

describe("resolveMeaning", () => {
  it("prefers an authored glossary note over the dictionary", () => {
    expect(resolveMeaning({ note: "はな → flower", englishMeaning: "nose" })).toEqual({
      source: "gloss",
      text: "はな → flower",
    });
  });

  it("uses the local dictionary when there is no note", () => {
    expect(resolveMeaning({ englishMeaning: "flower" })).toEqual({
      source: "dictionary",
      text: "flower",
    });
  });

  it("reports 'none' instead of borrowing a sentence translation", () => {
    expect(resolveMeaning({})).toEqual({ source: "none", text: "" });
    expect(resolveMeaning({ note: "" })).toEqual({ source: "none", text: "" });
  });
});
