import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { affixCandidates } from "../lib/ja-morphology";
import { lookupJapaneseDetail } from "../lib/jmdict";
import { hasWordChar } from "../lib/glossary";
import { parseSentences } from "../scripts/lib/story-format.mjs";
import type { Token } from "../lib/types";

/** What the reader shows a real definition for: a hit from the local
 *  dictionary (lemma, kanji alias, rebuilt affix host or surface), which is
 *  exactly what StoryText feeds the definition card. JA glossary notes don't
 *  exist, so a miss here means the card falls back to "No dictionary entry
 *  yet" instead of pretending the sentence translation is a definition. */
describe("Japanese real-definition coverage", () => {
  it("defines ≥ 60% of the tapped word occurrences in the corpus", () => {
    const file = path.join(process.cwd(), "data", "ja-tokens.generated.json");
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      stories: Record<string, Token[][]>;
    };

    let total = 0;
    let defined = 0;
    for (const sentences of Object.values(data.stories)) {
      for (const tokens of sentences) {
        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i];
          if (!t.surface || !hasWordChar(t.surface)) continue; // punctuation
          total += 1;
          if (lookupJapaneseDetail(t.lemma, t.surface, affixCandidates(tokens, i), t.reading)) {
            defined += 1;
          }
        }
      }
    }

    const ratio = total ? defined / total : 0;
    console.log(
      `JA coverage: ${defined}/${total} = ${(ratio * 100).toFixed(1)}% (target ≥ 60%)`
    );
    expect(total).toBeGreaterThan(0);
    expect(ratio).toBeGreaterThanOrEqual(0.6);
  });
});

/**
 * Phase 3 maps a tapped token onto the audio's word boundaries by walking a
 * character cursor over the sentence while rendering its tokens — which is only
 * correct if the tokens concatenate back to the sentence exactly. Sudachi is
 * lossless on this corpus today; this test is what keeps that true.
 */
describe("Japanese tokenization is lossless", () => {
  it("every sentence is exactly its token surfaces joined", () => {
    const data = JSON.parse(
      readFileSync(path.join(process.cwd(), "data", "ja-tokens.generated.json"), "utf8")
    ) as { stories: Record<string, Token[][]> };

    let checked = 0;
    for (const [key, sentences] of Object.entries(data.stories)) {
      const [lang, level, slug] = key.split("/");
      const raw = readFileSync(
        path.join(process.cwd(), "content", lang, level, `${slug}.md`),
        "utf8"
      );
      const texts = parseSentences(raw);
      expect(sentences.length, `${key}: sentence count`).toBe(texts.length);
      sentences.forEach((tokens, i) => {
        expect(tokens.map((t) => t.surface ?? "").join(""), `${key}#${i + 1}`).toBe(texts[i]);
        checked += 1;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
});
