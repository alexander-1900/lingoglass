import { describe, expect, it } from "vitest";
import { alignWords, AUDIO_SAMPLE_RATE, TICKS_PER_MS } from "../scripts/lib/audio-format.mjs";
import {
  FIXTURE_VOICE,
  fixtureWords,
  sentenceFixture,
  silencePcm,
  tonePcm,
} from "../scripts/lib/audio-fixture.mjs";

// The fixture exists so the whole audio pipeline can be exercised without the
// network. These tests pin the two things that make it trustworthy: its word
// events must be shaped exactly like edge-tts's (so alignWords and the client
// see production data — timing only, no character offsets), and its PCM must be
// real 24 kHz 16-bit mono (so the byte-exact timing math holds).

describe("fixtureWords", () => {
  it("returns word runs with their character ranges", () => {
    expect(fixtureWords("Hola, ¿qué tal?")).toEqual([
      { text: "Hola", charStart: 0, charEnd: 4 },
      { text: "qué", charStart: 7, charEnd: 10 },
      { text: "tal", charStart: 11, charEnd: 14 },
    ]);
  });

  it("keeps intra-word punctuation and splits at sentence punctuation", () => {
    expect(fixtureWords("l'école est là")).toEqual([
      { text: "l'école", charStart: 0, charEnd: 7 },
      { text: "est", charStart: 8, charEnd: 11 },
      { text: "là", charStart: 12, charEnd: 14 },
    ]);
    // Japanese has no spaces: a run is a kana/kanji phrase, and 、 breaks it —
    // exactly the shape a Sudachi token range sits inside.
    expect(fixtureWords("むかしむかし、おじいさんと")).toEqual([
      { text: "むかしむかし", charStart: 0, charEnd: 6 },
      { text: "おじいさんと", charStart: 7, charEnd: 13 },
    ]);
  });

  it("finds nothing in punctuation-only text", () => {
    expect(fixtureWords("… 。")).toEqual([]);
  });
});

describe("fixture PCM", () => {
  it("is 24 kHz 16-bit mono, so bytes map to ms at the production rate", () => {
    expect(tonePcm(440, 150).length).toBe(Math.round(AUDIO_SAMPLE_RATE * 0.15) * 2);
    expect(silencePcm(250).length).toBe(250 * 48); // 48 bytes per ms
  });

  it("fades in and out so consecutive beeps don't click", () => {
    const pcm = tonePcm(440, 50);
    expect(pcm.readInt16LE(0)).toBe(0); // silent at both edges…
    expect(pcm.readInt16LE(pcm.length - 2)).toBe(0);
    // …but at full 0.25 amplitude inside (sampled across the burst, since a sine
    // read at one arbitrary sample can sit exactly on a zero crossing).
    let peak = 0;
    for (let i = 0; i < pcm.length / 2; i += 1) {
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)));
    }
    expect(peak).toBeGreaterThan(7000); // 0.25 × 32767 ≈ 8191
  });
});

describe("sentenceFixture (edge-tts-shaped events)", () => {
  const text = "Hola, ¿qué tal?";
  const { pcm, words } = sentenceFixture(text, 0);

  it("emits one event per word, with offsets in ticks and nothing else", () => {
    expect(words).toHaveLength(3);
    expect(words[0]).toEqual({ text: "Hola", offset: 0, duration: 150 * TICKS_PER_MS });
    expect(words[1].offset).toBe(210 * TICKS_PER_MS); // 150 ms beep + 60 ms gap
    expect(words[2].offset).toBe(420 * TICKS_PER_MS);
  });

  it("narrates the text it was given (3 beeps + 2 gaps of PCM)", () => {
    expect(pcm.length).toBe(3 * tonePcm(0, 150).length + 2 * silencePcm(60).length);
  });

  it("survives the production alignment unchanged", () => {
    // This is the contract that matters: fixture events have to align back onto
    // the sentence exactly like edge-tts's, with no word left unaligned.
    const aligned = alignWords(text, words);
    expect(aligned.matched).toBe(aligned.total);
    expect(aligned.ranges).toEqual([
      { charStart: 0, charEnd: 4 },
      { charStart: 7, charEnd: 10 },
      { charStart: 11, charEnd: 14 },
    ]);
  });

  it("handles a sentence with no words at all", () => {
    const blip = sentenceFixture("…", 1);
    expect(blip.words).toEqual([]);
    expect(blip.pcm.length).toBeGreaterThan(0);
  });

  it("uses a voice name that can never collide with a real one", () => {
    expect(FIXTURE_VOICE).toMatch(/fixture/);
  });
});
