import { describe, expect, it } from "vitest";
import { glossaryLookup, isPunctToken, stripPunct, tokenRange, trimmedRange } from "../lib/glossary";
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

/** Word taps are matched against the audio's own word boundaries, which cover
 *  the spoken words only — so a token's tap range must exclude the punctuation
 *  and whitespace around it (but keep interior punctuation). */
describe("trimmedRange", () => {
  it("keeps the word characters and trims the edges", () => {
    expect(trimmedRange("mercado,")).toEqual({ start: 0, end: 7 });
    expect(trimmedRange("¡Hola!")).toEqual({ start: 1, end: 5 });
    expect(trimmedRange("「昔々」")).toEqual({ start: 1, end: 3 });
  });

  it("keeps interior punctuation (the word is one token)", () => {
    expect(trimmedRange("l'école")).toEqual({ start: 0, end: 7 });
    expect(trimmedRange("по-моему")).toEqual({ start: 0, end: 8 });
  });

  it("yields an empty span for separator-only tokens", () => {
    expect(trimmedRange("、")).toEqual({ start: 1, end: 1 });
    // Nothing but separators: the whole token is trimmed away, so the span
    // collapses at its end (and can never match a spoken boundary).
    expect(trimmedRange(" ... ")).toEqual({ start: 5, end: 5 });
  });
});

describe("tokenRange", () => {
  it("walks a left-to-right cursor over the sentence", () => {
    const target = "El perro corre.";
    expect(tokenRange(target, "El", 0)).toEqual({ start: 0, end: 2 });
    expect(tokenRange(target, " ", 2)).toEqual({ start: 2, end: 3 });
    expect(tokenRange(target, "perro", 3)).toEqual({ start: 3, end: 8 });
  });

  it("falls back to the token's own length when the surface was rewritten", () => {
    // A tokenizer that normalizes a surface must not shift every later tap.
    expect(tokenRange("El perro corre.", "gato", 3)).toEqual({ start: 3, end: 7 });
    expect(tokenRange("El perro corre.", "", 3)).toEqual({ start: 3, end: 3 });
  });
});
