import { describe, expect, it } from "vitest";
import {
  AUDIO_BYTES_PER_MS,
  TICKS_PER_MS,
  alignWords,
  manifestEntry,
  manifestEntryMatches,
  mp3BytesToMs,
  pcmBytesToMs,
  sentenceIndexAt,
  sentenceTimings,
  staleStoryFiles,
  storyFileNames,
  ticksToMs,
  wordTiming,
} from "../scripts/lib/audio-format.mjs";
import { sentenceHash8, storyHash8 } from "../scripts/lib/audio-hash.mjs";

describe("audio timing math", () => {
  it("converts PCM bytes to ms at the fixed output format", () => {
    // 24 kHz × 16-bit mono → exactly 48 bytes per millisecond.
    expect(AUDIO_BYTES_PER_MS).toBe(48);
    expect(pcmBytesToMs(48_000)).toBe(1000);
    expect(pcmBytesToMs(12_000)).toBe(250);
  });

  it("shares one frame grid with the MP3 the service returns", () => {
    // 48 kbps CBR is 6 bytes/ms, so 288 MP3 bytes = 2304 PCM bytes = one
    // 1152-sample frame = 48 ms. That equality is what lets the sentence MP3s be
    // joined at PCM level without moving a single word offset.
    expect(mp3BytesToMs(288)).toBe(48);
    expect(pcmBytesToMs(2304)).toBe(48);
    expect(mp3BytesToMs(6000)).toBe(pcmBytesToMs(48_000));
  });

  it("converts the voice's 100-ns ticks to ms", () => {
    expect(TICKS_PER_MS).toBe(10_000);
    expect(ticksToMs(10_000)).toBe(1);
    expect(ticksToMs(12_345_600)).toBe(1234.56);
  });

  it("lays sentences out with the fixed gap between them", () => {
    const timings = sentenceTimings([48_000, 24_000]); // 1 s + 0.5 s PCM
    expect(timings).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 1250, endMs: 1750 },
    ]);
  });

  it("keeps a non-integer PCM duration exact to 0.001 ms", () => {
    // 100 bytes ÷ 48 bytes/ms = 2.0833… ms — rounded identically to the client.
    expect(sentenceTimings([100])[0]).toEqual({ startMs: 0, endMs: 2.083 });
  });

  it("shifts a raw word event onto the sentence start", () => {
    const raw = { text: "Hola", offset: 10_000_000, duration: 5_000_000 }; // 1000 ms + 500 ms
    expect(wordTiming(raw, 1250)).toEqual({ text: "Hola", startMs: 2250, endMs: 2750 });
  });

  it("adds the aligned character range when one is supplied", () => {
    const raw = { text: "Hola", offset: 0, duration: 5_000_000 };
    expect(wordTiming(raw, 0, { charStart: 0, charEnd: 4 })).toEqual({
      text: "Hola",
      startMs: 0,
      endMs: 500,
      charStart: 0,
      charEnd: 4,
    });
  });
});

describe("alignWords (where each word event sits in the sentence)", () => {
  it("walks the sentence and locates every event", () => {
    const out = alignWords("Hola, ¿qué tal?", [
      { text: "Hola" },
      { text: "qué" }, // "¿" sits at index 6, so this one starts at 7
      { text: "tal" },
    ]);
    expect(out.matched).toBe(3);
    expect(out.total).toBe(3);
    expect(out.ranges).toEqual([
      { charStart: 0, charEnd: 4 },
      { charStart: 7, charEnd: 10 },
      { charStart: 11, charEnd: 14 },
    ]);
  });

  it("keeps a repeated word on its own occurrence", () => {
    // The forward scan is the whole point: searching from 0 every time would
    // hand all three events the first "no" and put three different taps on the
    // same 200 ms of audio.
    const out = alignWords("No, no y no.", [{ text: "No" }, { text: "no" }, { text: "no" }]);
    expect(out.ranges).toEqual([
      { charStart: 0, charEnd: 2 },
      { charStart: 4, charEnd: 6 },
      { charStart: 9, charEnd: 11 },
    ]);
  });

  it("counts a surrogate pair as two UTF-16 units, exactly like the client", () => {
    // 𠮟 is 2 UTF-16 units / 1 code point. The reader indexes its rendered text in
    // UTF-16, so an alignment that counted code points would shift every later
    // tap in the sentence by one character.
    const text = "𠮟る子。";
    expect(text.length).toBe(5); // UTF-16
    expect(Array.from(text).length).toBe(4); // code points
    const out = alignWords(text, [{ text: "𠮟る" }, { text: "子" }, { text: "。" }]);
    expect(out.matched).toBe(3);
    expect(out.ranges).toEqual([
      { charStart: 0, charEnd: 3 },
      { charStart: 3, charEnd: 4 },
      { charStart: 4, charEnd: 5 },
    ]);
  });

  it("recovers an event the service case-folded", () => {
    const out = alignWords("El niño está aquí", [{ text: "NIÑO" }]);
    expect(out.ranges).toEqual([{ charStart: 3, charEnd: 7 }]);
  });

  it("follows an event that arrived out of order", () => {
    const out = alignWords("uno dos tres", [{ text: "dos" }, { text: "uno" }]);
    expect(out.ranges).toEqual([
      { charStart: 4, charEnd: 7 },
      { charStart: 0, charEnd: 3 },
    ]);
  });

  it("leaves a word it cannot find unaligned instead of guessing", () => {
    // A tap on an unaligned word falls back to the device voice. A guessed range
    // would play the wrong audio, which is the worse failure.
    const out = alignWords("Hola.", [{ text: "adiós" }, { text: "" }, {}]);
    expect(out).toEqual({ matched: 0, total: 3, ranges: [null, null, null] });
  });
});

describe("sentenceIndexAt (currentTime → sentence)", () => {
  // Sentence 0 covers [0, 1000); 250 ms gap; sentence 1 starts at 1250.
  const timings = sentenceTimings([48_000, 24_000]);

  it("resolves starts, ends and gap regions", () => {
    expect(sentenceIndexAt(0, timings)).toBe(0);
    expect(sentenceIndexAt(999, timings)).toBe(0);
    expect(sentenceIndexAt(1000, timings)).toBe(0); // end is exclusive → still sentence 0
    expect(sentenceIndexAt(1249.999, timings)).toBe(0); // the gap belongs to the sentence before it
    expect(sentenceIndexAt(1250, timings)).toBe(1); // exact start of the next sentence
    expect(sentenceIndexAt(9999, timings)).toBe(1); // past the end → clamped to the last
  });

  it("returns the first sentence before its start and -1 for no sentences", () => {
    expect(sentenceIndexAt(0, [{ startMs: 100, endMs: 200 }])).toBe(0);
    expect(sentenceIndexAt(500, [])).toBe(-1);
  });
});

describe("output file planning (hash-skip)", () => {
  it("names files by slug + content hash", () => {
    expect(storyFileNames("01-momotaro", "deadbeef")).toEqual({
      mp3: "01-momotaro.deadbeef.mp3",
      timing: "01-momotaro.deadbeef.json",
    });
  });

  it("finds only this slug's previous-hash files as stale", () => {
    const names = [
      "01-momotaro.deadbeef.mp3",
      "01-momotaro.deadbeef.json",
      "01-momotaro.00000000.mp3",
      "01-momotaro.00000000.json",
      "01-other.deadbeef.mp3",
      "01-momotaro.deadbeef.txt",
    ];
    expect(staleStoryFiles(names, "01-momotaro", "deadbeef")).toEqual([
      "01-momotaro.00000000.mp3",
      "01-momotaro.00000000.json",
    ]);
  });

  it("builds manifest entries and matches them against the current hash", () => {
    const entry = manifestEntry("ja", "01-momotaro", "deadbeef", 123456.7);
    expect(entry).toEqual({
      mp3: "/audio/ja/01-momotaro.deadbeef.mp3",
      timing: "/audio/ja/01-momotaro.deadbeef.json",
      duration: 123457,
    });
    expect(manifestEntryMatches(entry, "01-momotaro", "deadbeef")).toBe(true);
    expect(manifestEntryMatches(entry, "01-momotaro", "cafebabe")).toBe(false);
    expect(manifestEntryMatches(undefined, "01-momotaro", "deadbeef")).toBe(false);
  });
});

describe("content hashing (what triggers re-synthesis)", () => {
  const texts = ["Hola.", "¿Qué tal?"];

  it("is deterministic and 8 hex chars", () => {
    expect(storyHash8("es", "es-ES-AlvaroNeural", "+25%", texts)).toBe(
      storyHash8("es", "es-ES-AlvaroNeural", "+25%", texts)
    );
    expect(storyHash8("es", "es-ES-AlvaroNeural", "+25%", texts)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when lang, voice, rate, text or order changes", () => {
    const base = storyHash8("es", "voice-a", "+25%", texts);
    expect(storyHash8("ru", "voice-a", "+25%", texts)).not.toBe(base);
    expect(storyHash8("es", "voice-b", "+25%", texts)).not.toBe(base);
    // A rate change must never silently reuse audio synthesized at another pace.
    expect(storyHash8("es", "voice-a", "+40%", texts)).not.toBe(base);
    expect(storyHash8("es", "voice-a", "+25%", ["Hola.", "¿Qué tal?!"])).not.toBe(base);
    expect(storyHash8("es", "voice-a", "+25%", [...texts].reverse())).not.toBe(base);
  });

  it("keys per-sentence cache entries by voice + rate + text", () => {
    expect(sentenceHash8("v", "+25%", "Hola.")).toMatch(/^[0-9a-f]{8}$/);
    expect(sentenceHash8("v", "+25%", "Hola.")).toBe(sentenceHash8("v", "+25%", "Hola."));
    expect(sentenceHash8("v", "+25%", "Hola.")).not.toBe(sentenceHash8("v", "+25%", "Hola"));
    expect(sentenceHash8("w", "+25%", "Hola.")).not.toBe(sentenceHash8("v", "+25%", "Hola."));
    expect(sentenceHash8("v", "+40%", "Hola.")).not.toBe(sentenceHash8("v", "+25%", "Hola."));
  });
});
