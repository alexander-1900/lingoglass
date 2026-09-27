import { describe, expect, it } from "vitest";
import { glossaryLookup, isPunctToken, stripPunct } from "../lib/glossary";
import type { StorySentence } from "../lib/types";

const sent = (glossary: { surface: string; note: string }[]): StorySentence => ({
  target: "…",
  en: "…",
  glossary,
});

describe("glossaryLookup", () => {
  it("matches a single-word surface exactly (case + punctuation insensitive)", () => {
    expect(glossaryLookup(sent([{ surface: "Hola", note: "hello" }]), "¡hola,")).toBe("hello");
  });

  it("never substring-matches (regression: the old startsWith matched в → вместе)", () => {
    expect(
      glossaryLookup(sent([{ surface: "вместе", note: "together" }]), "в")
    ).toBeUndefined();
  });

  it("answers any word of a multi-word gloss phrase (the fixed phrase path)", () => {
    const s = sent([{ surface: "por eso", note: "phrase: therefore" }]);
    expect(glossaryLookup(s, "por")).toBe("phrase: therefore");
    expect(glossaryLookup(s, "eso")).toBe("phrase: therefore");
  });

  it("prefers an exact single-word gloss over a phrase part", () => {
    const s = sent([
      { surface: "por eso", note: "phrase: therefore" },
      { surface: "por", note: "preposition: for" },
    ]);
    expect(glossaryLookup(s, "por")).toBe("preposition: for");
  });

  it("returns undefined when nothing matches or the tap is punctuation-only", () => {
    expect(glossaryLookup(sent([{ surface: "hola", note: "hi" }]), "adiós")).toBeUndefined();
    expect(glossaryLookup(sent([]), "hola")).toBeUndefined();
    expect(glossaryLookup(sent([{ surface: "…", note: "x" }]), "…")).toBeUndefined();
  });
});

describe("token helpers", () => {
  it("stripPunct removes separators and whitespace", () => {
    expect(stripPunct("  ¡Hola, mundo!  ")).toBe("Holamundo");
  });
  it("isPunctToken recognizes separator runs only", () => {
    expect(isPunctToken("... ")).toBe(true);
    expect(isPunctToken("hola")).toBe(false);
  });
});
