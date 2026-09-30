/**
 * Pure helpers for reading Sudachi token annotations in the story reader:
 * POS labelling, affix reconstruction and duplicate-word identity. No React
 * and no I/O, so it stays unit-testable like lib/glossary.ts.
 */
import { hasWordChar } from "./glossary";
import type { Token } from "./types";

/** Sudachi first-level POS tag → short English label for the definition card. */
const POS_LABELS: Record<string, string> = {
  名詞: "noun",
  動詞: "verb",
  形容詞: "adjective",
  形状詞: "adjective",
  副詞: "adverb",
  助詞: "particle",
  助動詞: "auxiliary",
  接尾辞: "suffix",
  接頭辞: "prefix",
  連体詞: "determiner",
  代名詞: "pronoun",
  接続詞: "conjunction",
  感動詞: "interjection",
  記号: "symbol",
  補助記号: "symbol",
};

/** English POS label for the pill; undefined when POS is unknown (the regex
 *  fallback carries none) so the caller can fall back to the level pill alone. */
export function posLabel(pos?: string): string | undefined {
  if (!pos) return undefined;
  const parts = pos.split(",");
  // 数詞 is a 名詞 sub-tag, but a digit reads as a numeral, not "a noun".
  if (parts.includes("数詞")) return "numeral";
  return POS_LABELS[parts[0]];
}

/** Whether the token may join the story-wide repeat highlight. Particles and
 *  auxiliaries are excluded: た (×338) and て (×226) would otherwise tint most
 *  of the corpus for a single tap. Unknown POS → true (play it safe). */
export function isContentPos(pos?: string): boolean {
  if (!pos) return true;
  const head = pos.split(",")[0];
  return head !== "助詞" && head !== "助動詞";
}

/** 0-based occurrence ordinal of `word` within one tally. Sentence + word alone
 *  is ambiguous when a word repeats (two 桃 in one sentence), which used to
 *  mount one definition card per occurrence. The tally is per sentence, per
 *  render — occurrence identity is UI-only and never reaches bookmarks. */
export function nextOccurrence(seen: Map<string, number>, word: string): number {
  const n = seen.get(word) ?? 0;
  seen.set(word, n + 1);
  return n;
}

export interface WordIdentity {
  word: string;
  sentIdx: number;
  occ: number;
}

/** Where a token sits relative to the open card: `tapped` is the exact
 *  occurrence that was clicked (it alone owns the card, the active styling and
 *  the roving Tab stop); every other occurrence of the same word is a `repeat`
 *  (highlight only, and only for content words). */
export type TokenRole = "tapped" | "repeat" | null;

export function tokenRole(
  open: WordIdentity | null | undefined,
  cur: WordIdentity,
  pos?: string
): TokenRole {
  if (!open || open.word !== cur.word) return null;
  if (open.sentIdx === cur.sentIdx && open.occ === cur.occ) return "tapped";
  return isContentPos(pos) ? "repeat" : null;
}

/** A rebuilt host word: surface concatenation, plus the concatenated reading
 *  when every part has one (オ + ジイ + サン → オジイサン). */
export interface AffixCandidate {
  surface: string;
  reading?: string;
}

function mergeParts(parts: (Token | undefined)[]): AffixCandidate | undefined {
  if (!parts.length || parts.some((p) => !p || !hasWordChar(p.surface))) return undefined;
  const toks = parts as Token[];
  const readings = toks.map((t) => t.reading);
  return {
    surface: toks.map((t) => t.surface).join(""),
    reading: readings.every(Boolean) ? readings.join("") : undefined,
  };
}

/**
 * Sudachi splits affixes off their host word (お + じい + さん), so neither
 * fragment is in any dictionary while the host (おじいさん) is. This rebuilds
 * the host word, longest form first, for dictionary lookup and for the card's
 * lemma line. Only 接頭辞/接尾辞 are merged — 助動詞 runs (まし + た) are
 * inflection, not affixes, and stay tappable on their own.
 */
export function affixCandidates(tokens: readonly Token[], i: number): AffixCandidate[] {
  const t = tokens[i];
  if (!t) return [];
  const head = (t.pos ?? "").split(",")[0];
  const out: AffixCandidate[] = [];
  if (head === "接頭辞") {
    const three = mergeParts([t, tokens[i + 1], tokens[i + 2]]);
    if (three) out.push(three);
    const two = mergeParts([t, tokens[i + 1]]);
    if (two) out.push(two);
    return out;
  }
  if (head === "接尾辞") {
    const three = mergeParts([tokens[i - 2], tokens[i - 1], t]);
    if (three) out.push(three);
    const two = mergeParts([tokens[i - 1], t]);
    if (two) out.push(two);
    return out;
  }
  return out;
}

/** Where the card's main text came from: an authored glossary note, the local
 *  dictionary, or nothing at all. "none" makes the card say so — the sentence
 *  translation is context, never a definition. */
export type MeaningSource = "gloss" | "dictionary" | "none";

export interface MeaningResolution {
  source: MeaningSource;
  text: string;
}

export function resolveMeaning(input: {
  note?: string;
  englishMeaning?: string;
}): MeaningResolution {
  if (input.note) return { source: "gloss", text: input.note };
  if (input.englishMeaning) return { source: "dictionary", text: input.englishMeaning };
  return { source: "none", text: "" };
}
