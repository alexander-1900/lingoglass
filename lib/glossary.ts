import type { StorySentence } from "./types";

/**
 * Word/gloss matching for the reader popover — pure (no DOM/React) so it can
 * be unit-tested directly.
 *
 * Historical bug: `stripPunct` also strips whitespace, so normalizing a
 * multi-word surface BEFORE splitting it collapsed "por eso" → "poreso" and
 * the phrase fallback silently never matched (82 authored phrase notes were
 * dead). Split on whitespace first, normalize each word afterwards.
 */

/** Characters that separate/tokenize words — single source of truth shared by
 *  the reader's sentence splitter, gloss matching, and the TTS emptiness
 *  guard (they previously carried three near-identical copies). */
export const SEPARATORS =
  "\\s.,!?;:«»\"'’‘“”„()—–…¿¡。、、「」『』・！？〈〉《》‹›-";

const PUNCT_TOKEN_RE = new RegExp(`^[${SEPARATORS}]+$`);
const PUNCT_GLOBAL_RE = new RegExp(`[${SEPARATORS}]`, "g");

export function isPunctToken(w: string): boolean {
  return PUNCT_TOKEN_RE.test(w);
}

/**
 * True when a token holds at least one letter or digit — i.e. it is a word the
 * reader should make tappable/focusable and (for JA) give a romaji line.
 *
 * Broader than isPunctToken, which only knows the SEPARATORS list: symbols
 * outside it (※ ― № ～) are non-words too. The 々 iteration mark counts as a
 * letter (Lm), so meaningful kana compounds stay interactive.
 */
export function hasWordChar(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

/** Strip separators/punctuation (and whitespace) from a token. */
export function stripPunct(s: string): string {
  return s.replace(PUNCT_GLOBAL_RE, "");
}

const LEAD_SEP_RE = new RegExp(`^[${SEPARATORS}]+`);
const TRAIL_SEP_RE = new RegExp(`[${SEPARATORS}]+$`);

/**
 * The `[start, end)` span of a rendered token's actual WORD characters.
 *
 * Word taps are matched against the audio's own boundaries, and the voice points
 * at the spoken words — the trailing "," of "mercado," belongs to no boundary. So
 * trim exactly what stripPunct trims at the EDGES (interior punctuation such as
 * "l'école" stays inside the span). A punctuation-only token yields an empty
 * span, which can never match a boundary.
 */
export function trimmedRange(token: string): { start: number; end: number } {
  const lead = token.match(LEAD_SEP_RE)?.[0].length ?? 0;
  const trail = token.match(TRAIL_SEP_RE)?.[0].length ?? 0;
  return { start: lead, end: Math.max(lead, token.length - trail) };
}

/**
 * Character range of one rendered token inside the sentence text, advancing a
 * cursor left to right (the reader walks its tokens in order).
 *
 * Word taps need real offsets to match the audio's own boundaries, and both
 * tokenizer paths are lossless (Sudachi surfaces and the separator split
 * concatenate back to the sentence — asserted for the whole JA corpus in
 * tests/ja-coverage.test.ts). `indexOf` at/after the cursor still self-corrects
 * if a surface is ever rewritten, falling back to the token's own length.
 */
export function tokenRange(
  target: string,
  surface: string,
  at: number
): { start: number; end: number } {
  const i = surface ? target.indexOf(surface, at) : -1;
  if (i === -1) return { start: at, end: at + surface.length };
  return { start: i, end: i + surface.length };
}

/** Lowercase + strip: the identity used for both sides of a gloss match. */
function norm(s: string): string {
  return stripPunct(s).toLowerCase();
}

/**
 * Gloss note for a tapped word within one sentence:
 * 1. Exact match on the gloss surface (`* palabra (note)`).
 * 2. Conservative phrase fallback: the word equals one of the whitespace-split
 *    words of a multi-word surface (`* por eso (…)` answers for `por`/`eso`).
 *    Never a substring match — the old bidirectional startsWith matched
 *    「в」→「вместе」.
 */
export function glossaryLookup(
  sentence: StorySentence,
  word: string
): string | undefined {
  const clean = norm(word);
  if (!clean) return undefined;
  const exact = sentence.glossary.find((g) => norm(g.surface) === clean);
  if (exact) return exact.note;
  const phrase = sentence.glossary.find((g) =>
    g.surface
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => stripPunct(part))
      .includes(clean)
  );
  return phrase?.note;
}
