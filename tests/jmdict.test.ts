import { describe, expect, it } from "vitest";
import { lookupJapaneseDetail, lookupJapaneseMeaning } from "../lib/jmdict";
import type { AffixCandidate } from "../lib/ja-morphology";

describe("lookupJapaneseMeaning", () => {
  it("resolves the Sudachi lemma first (飲みます → 飲む)", () => {
    expect(lookupJapaneseMeaning("飲む", "飲みます")).toBe("to drink");
  });

  it("falls back to the surface when there is no lemma", () => {
    expect(lookupJapaneseMeaning(undefined, "学校")).toBe("school");
  });

  it("returns undefined for words outside the local dictionary", () => {
    expect(lookupJapaneseMeaning("安珍", "安珍")).toBeUndefined();
  });

  it("answers single digits without needing a dictionary entry", () => {
    expect(lookupJapaneseMeaning(undefined, "1")).toBe("one");
    expect(lookupJapaneseMeaning(undefined, "9")).toBe("nine");
  });
});

describe("lookupJapaneseDetail", () => {
  it("resolves kanji lemma aliases (為る → する)", () => {
    expect(lookupJapaneseDetail("為る", "為る", undefined, "シ")).toMatchObject({
      gloss: "to do",
      key: "する",
      via: "alias",
    });
  });

  it("resolves the other kanji-lemma aliases", () => {
    expect(lookupJapaneseDetail("居る", "居る")?.key).toBe("いる");
    expect(lookupJapaneseDetail("成る", "成る")?.key).toBe("なる");
    expect(lookupJapaneseDetail("有る", "有る")?.key).toBe("ある");
    expect(lookupJapaneseDetail("其の", "其の")?.key).toBe("その");
    expect(lookupJapaneseDetail("仕舞う", "仕舞う")?.key).toBe("しまう");
    expect(lookupJapaneseDetail("無い", "無い")?.key).toBe("ない");
  });

  it("guards the rare なる reading of 為る", () => {
    expect(lookupJapaneseDetail("為る", "為る", undefined, "ナル")).toBeUndefined();
  });

  it("answers a tapped affix from its host word (さん → おじいさん)", () => {
    const affixes: AffixCandidate[] = [{ surface: "おじいさん", reading: "オジイサン" }];
    expect(lookupJapaneseDetail("さん", "さん", affixes, "サン")).toMatchObject({
      gloss: "grandfather; old man",
      key: "おじいさん",
      via: "affix",
      reading: "オジイサン",
    });
  });

  it("prefers the lemma over an affix candidate", () => {
    const affixes: AffixCandidate[] = [{ surface: "おじいさん" }];
    expect(lookupJapaneseDetail("中", "中", affixes)?.via).toBe("lemma");
  });

  it("knows the high-frequency grammar fragments", () => {
    expect(lookupJapaneseDetail("た", "た")?.gloss).toContain("auxiliary");
    expect(lookupJapaneseDetail("ます", "ます")?.gloss).toContain("polite");
    expect(lookupJapaneseDetail("達", "達")?.gloss).toContain("plural");
    expect(lookupJapaneseDetail("へ", "へ")?.gloss).toContain("particle");
  });

  it("reports which key matched so the card can show it", () => {
    const r = lookupJapaneseDetail(undefined, "言う");
    expect(r).toMatchObject({ key: "言う", via: "surface", gloss: "to say" });
  });
});
