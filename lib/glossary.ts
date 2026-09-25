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

/** Strip separators/punctuation (and whitespace) from a token. */
export function stripPunct(s: string): string {
  return s.replace(PUNCT_GLOBAL_RE, "");
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
