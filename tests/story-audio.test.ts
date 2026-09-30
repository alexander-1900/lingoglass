import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isEntryUsable, isTimingUsable, storyAudioKey, wordIndexForChar } from "../lib/story-audio";
import type {
  StoryAudioSentence,
  StoryAudioTiming,
  StoryAudioWord,
} from "../lib/story-audio";
import { hasWordChar, tokenRange, trimmedRange } from "../lib/glossary";
import { LEVELS, LANGS } from "../lib/types";
import type { Token } from "../lib/types";
import { parseStoryFile } from "../lib/stories";
import { SENTENCE_GAP_MS, TIMING_VERSION } from "../scripts/lib/audio-format.mjs";
import { parseSentences } from "../scripts/lib/story-format.mjs";

// The guards in lib/story-audio.ts decide whether pre-generated neural audio is
// trusted at all; every one of them failing means "fall back to Web Speech", so
// a false positive (stale audio accepted) is the bug these tests exist for.

const TEXTS = ["Buenos días.", "¿Cómo estás?", "Hasta luego."];
const SPEECH_MS = 2000;

/** A timing JSON exactly as scripts/generate-audio.mjs writes it. */
function makeTiming(texts: readonly string[] = TEXTS): StoryAudioTiming {
  return {
    version: TIMING_VERSION,
    lang: "es",
    voice: "es-ES-AlvaroNeural",
    sampleRate: 24000,
    gapMs: SENTENCE_GAP_MS,
    durationMs: texts.length * (SPEECH_MS + SENTENCE_GAP_MS) - SENTENCE_GAP_MS,
    sentences: texts.map((text, i) => {
      const startMs = i * (SPEECH_MS + SENTENCE_GAP_MS);
      return { text, startMs, endMs: startMs + SPEECH_MS, words: [] };
    }),
  };
}

describe("storyAudioKey", () => {
  it("matches the generator's manifest key", () => {
    expect(storyAudioKey("es", "01-cambio-de-rumbo")).toBe("es/01-cambio-de-rumbo");
    expect(storyAudioKey("ja", "01-momotaro")).toBe("ja/01-momotaro");
  });
});

describe("isEntryUsable", () => {
  it("accepts a well-formed record", () => {
    expect(
      isEntryUsable({
        mp3: "/audio/es/01-cambio-de-rumbo.a1b2c3d4.mp3",
        timing: "/audio/es/01-cambio-de-rumbo.a1b2c3d4.json",
        duration: 42100,
      })
    ).toBe(true);
  });

  it("rejects anything that could build a bad URL", () => {
    const good = {
      mp3: "/audio/es/x.mp3",
      timing: "/audio/es/x.json",
      duration: 1,
    };
    expect(isEntryUsable(null)).toBe(false);
    expect(isEntryUsable(undefined)).toBe(false);
    expect(isEntryUsable("x")).toBe(false);
    expect(isEntryUsable({ ...good, timing: undefined })).toBe(false);
    expect(isEntryUsable({ ...good, mp3: "audio/es/x.mp3" })).toBe(false);
    expect(isEntryUsable({ ...good, mp3: 42 })).toBe(false);
  });
});

describe("isTimingUsable", () => {
  it("accepts a timing JSON that matches the story", () => {
    expect(isTimingUsable(makeTiming(), TEXTS)).toBe(true);
  });

  it("rejects a story whose text changed without regenerating audio", () => {
    const stale = makeTiming();
    stale.sentences[1].text = "¿Cómo estás hoy?"; // old narration, new markdown
    expect(isTimingUsable(stale, TEXTS)).toBe(false);
  });

  it("rejects a different sentence count", () => {
    expect(isTimingUsable(makeTiming([...TEXTS, "Una más."]), TEXTS)).toBe(false);
    expect(isTimingUsable(makeTiming(TEXTS.slice(0, 2)), TEXTS)).toBe(false);
  });

  it("rejects an unknown layout version", () => {
    const bumped = makeTiming();
    bumped.version = TIMING_VERSION + 1;
    expect(isTimingUsable(bumped, TEXTS)).toBe(false);
  });

  it("rejects malformed or missing JSON shapes", () => {
    expect(isTimingUsable(null, TEXTS)).toBe(false);
    expect(isTimingUsable("[]", TEXTS)).toBe(false);
    expect(isTimingUsable({ version: TIMING_VERSION }, TEXTS)).toBe(false);
    expect(isTimingUsable({ version: TIMING_VERSION, sentences: {} }, TEXTS)).toBe(false);

    const noText = makeTiming();
    delete (noText.sentences[0] as { text?: string }).text;
    expect(isTimingUsable(noText, TEXTS)).toBe(false);
  });

  it("rejects non-finite or descending starts", () => {
    const nan = makeTiming();
    nan.sentences[2].startMs = Number.NaN;
    expect(isTimingUsable(nan, TEXTS)).toBe(false);

    const backwards = makeTiming();
    backwards.sentences[1].startMs = 99_000;
    expect(isTimingUsable(backwards, TEXTS)).toBe(false);
  });

  it("compares against the texts given, not a cached verdict", () => {
    const timing = makeTiming();
    expect(isTimingUsable(timing, TEXTS)).toBe(true);
    expect(isTimingUsable(timing, [...TEXTS, "Distinta."])).toBe(false);
  });
});

describe("wordIndexForChar (tapped token → spoken word)", () => {
  const boundary = (charStart?: number, charEnd?: number) => ({
    text: "",
    startMs: 0,
    endMs: 0,
    charStart,
    charEnd,
  });
  const sentence = (words: ReturnType<typeof boundary>[]): StoryAudioSentence => ({
    text: "…",
    startMs: 0,
    endMs: 1,
    words,
  });

  it("prefers the boundary that fully contains the tapped word", () => {
    // 「桃」 inside the voice's 「桃太郎」 phrase must play the phrase, not step into
    // a neighbouring boundary that merely overlaps it.
    const s = sentence([boundary(0, 3), boundary(3, 8)]);
    expect(wordIndexForChar(s, 4, 6)).toBe(1);
    expect(wordIndexForChar(s, 0, 3)).toBe(0);
    expect(wordIndexForChar(s, 3, 8)).toBe(1);
  });

  it("falls back to the first partially overlapping boundary", () => {
    const s = sentence([boundary(0, 3), boundary(3, 8)]);
    expect(wordIndexForChar(s, 2, 5)).toBe(0);
  });

  it("returns -1 when nothing overlaps or ranges are missing", () => {
    expect(wordIndexForChar(sentence([boundary(0, 3)]), 10, 12)).toBe(-1);
    expect(wordIndexForChar(sentence([]), 0, 3)).toBe(-1);
    expect(wordIndexForChar(sentence([boundary(undefined, undefined)]), 0, 3)).toBe(-1);
  });
});

// End-to-end mapping on real content: the reader's token cursor, the punctuation
// trim and the boundary matcher must agree on actual Japanese text — that
// combination is exactly what a word tap depends on.
describe("tap → boundary mapping on a real Japanese sentence", () => {
  it("maps every word token onto the phrase boundary that contains it", () => {
    const data = JSON.parse(
      readFileSync(path.join(process.cwd(), "data", "ja-tokens.generated.json"), "utf8")
    ) as { stories: Record<string, Token[][]> };

    const keys = Object.keys(data.stories);
    const key = keys.find((k) => k.startsWith("ja/n5/")) ?? keys[0];
    const [lang, level, slug] = key.split("/");
    const sentence = parseSentences(
      readFileSync(path.join(process.cwd(), "content", lang, level, `${slug}.md`), "utf8")
    )[0];
    const tokens = data.stories[key][0];

    // 1. Walk the tokens exactly as StoryText does while rendering them.
    let cursor = 0;
    const spans = tokens.map((t) => {
      const surface = t.surface ?? "";
      const range = tokenRange(sentence, surface, cursor);
      cursor = range.end;
      return { surface, start: range.start, end: range.end };
    });
    expect(cursor, "tokens must cover the sentence").toBe(sentence.length);

    // 2. Phrase-style boundaries (the voice segments Japanese into phrases, not
    //    single morphemes), so group the tokens into threes.
    const words: StoryAudioWord[] = [];
    for (let i = 0; i < spans.length; i += 3) {
      const group = spans.slice(i, i + 3);
      const charStart = group[0].start;
      const charEnd = group[group.length - 1].end;
      words.push({
        text: sentence.slice(charStart, charEnd),
        startMs: 0,
        endMs: 0,
        charStart,
        charEnd,
      });
    }
    const timing: StoryAudioSentence = { text: sentence, startMs: 0, endMs: 1, words };

    // 3. Every tappable token must land inside the phrase it was spoken in.
    let checked = 0;
    for (const span of spans) {
      if (!hasWordChar(span.surface)) continue;
      const trim = trimmedRange(span.surface);
      const charStart = span.start + trim.start;
      const charEnd = span.start + trim.end;
      if (charEnd <= charStart) continue;

      const wi = wordIndexForChar(timing, charStart, charEnd);
      expect(wi, `${key}: ${span.surface}`).toBeGreaterThanOrEqual(0);
      const w = words[wi];
      expect(w.charStart as number).toBeLessThanOrEqual(charStart);
      expect(w.charEnd as number).toBeGreaterThanOrEqual(charEnd);
      // The resolved range must slice back to the boundary's own text: this is
      // what a wrong offset unit would break.
      expect(w.text).toBe(sentence.slice(w.charStart as number, w.charEnd as number));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

// The whole trust model rests on the reader's sentence strings being the exact
// strings the generator synthesized (the generator stores them in the timing
// JSON). Both go through scripts/lib/story-format.mjs, but this repo has been
// bitten by silently drifting parsers before, so the equality is asserted on
// every real story file rather than assumed.
describe("generator ↔ reader sentence agreement", () => {
  it("every story's sentences are identical in both paths", () => {
    const root = path.join(process.cwd(), "content");
    let checked = 0;
    for (const lang of LANGS) {
      for (const level of LEVELS[lang] ?? []) {
        const dir = path.join(root, lang, level);
        let files: string[] = [];
        try {
          files = readdirSync(dir).filter((f) => f.endsWith(".md"));
        } catch {
          continue; // level without a directory yet
        }
        for (const file of files) {
          const raw = readFileSync(path.join(dir, file), "utf-8");
          const narrated = parseSentences(raw); // scripts/generate-audio.mjs
          const displayed = parseStoryFile(raw).sentences.map((s) => s.target); // lib/stories.ts
          expect(displayed, `${lang}/${level}/${file}`).toEqual(narrated);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
