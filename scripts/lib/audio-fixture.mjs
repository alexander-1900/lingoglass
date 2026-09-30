// FIXTURE audio for the story-audio pipeline (`npm run audio:generate --
// --fixture`): deterministic beeps synthesized locally, standing in for edge-tts
// so the END-TO-END path — PCM assembly, silence gaps, exact byte-length timing
// math, word alignment, one ffmpeg CBR pass, hash-skip and the manifest — can be
// exercised with no network and no Python. That is also what keeps it usable as
// a smoke test where the real pipeline cannot run at all.
//
// It deliberately mimics the SHAPES, not just the output: a word event carries
// text plus offset/duration in 100-ns ticks and NOTHING else, exactly like the
// sidecar scripts/lib/edge_tts_synth.py writes, so every downstream step
// (alignWords, wordTiming, the client) sees production data — including the fact
// that character ranges must be recovered from the sentence text itself. The
// only difference the reader can observe is the `fixture` flag in the manifest
// and the voice name, which keeps fixture files out of the real run's hash space
// (so a real run re-synthesizes instead of skipping, and cleans beeps as stale).
//
// Node-only (Buffer) — never imported by the client bundle.

import {
  AUDIO_BYTES_PER_MS,
  AUDIO_CHANNELS,
  AUDIO_SAMPLE_RATE,
  TICKS_PER_MS,
} from "./audio-format.mjs";

/** Manifest `voice` for fixture runs — also what keeps the hash distinct. */
export const FIXTURE_VOICE = "fixture-beeps";

/** One spoken "word" in the beep track. */
const WORD_MS = 150;
/** Silence between words: long enough that every boundary is audibly separate. */
const WORD_GAP_MS = 60;

/** Runs of letters/digits (with intra-word ' - ’) — the words a beep stands in
 *  for. Japanese has no spaces, so a run is a kana/kanji phrase: the reader's
 *  Sudachi tokens are sub-ranges of it, which is exactly how a tap maps onto a
 *  real edge-tts phrase boundary. */
const WORD_RUN_RE = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’\-]*/gu;

/** @param {string} text @returns {{ text: string, charStart: number, charEnd: number }[]} */
export function fixtureWords(text) {
  const out = [];
  for (const m of text.matchAll(WORD_RUN_RE)) {
    out.push({ text: m[0], charStart: m.index, charEnd: m.index + m[0].length });
  }
  return out;
}

/** 16-bit mono PCM of one sine burst, with short fades so beeps don't click.
 * @param {number} freqHz @param {number} ms @returns {Buffer} */
export function tonePcm(freqHz, ms) {
  const samples = Math.max(1, Math.round((AUDIO_SAMPLE_RATE * ms) / 1000));
  const pcm = Buffer.alloc(samples * 2 * AUDIO_CHANNELS);
  const fade = Math.max(1, Math.round(AUDIO_SAMPLE_RATE * 0.008)); // 8 ms
  for (let i = 0; i < samples; i += 1) {
    const envelope = Math.min(1, i / fade, (samples - 1 - i) / fade);
    const value = Math.sin((2 * Math.PI * freqHz * i) / AUDIO_SAMPLE_RATE) * 0.25 * envelope;
    pcm.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  return pcm;
}

/** @param {number} ms @returns {Buffer} */
export function silencePcm(ms) {
  return Buffer.alloc(Math.round(ms * AUDIO_BYTES_PER_MS));
}

/** Beep pitch: a per-word ladder plus a per-sentence offset, so both the word
 *  and the sentence a word belongs to are audible. */
function pitchFor(sentenceIndex, wordIndex) {
  return 180 + 40 * (wordIndex % 8) + 10 * (sentenceIndex % 5);
}

/**
 * One sentence as PCM + edge-tts-shaped word events (ticks, no character
 * offsets — those are recovered downstream by alignWords, exactly as for real
 * narration).
 * @param {string} text
 * @param {number} sentenceIndex
 * @returns {{ pcm: Buffer, words: { text: string, offset: number, duration: number }[] }}
 */
export function sentenceFixture(text, sentenceIndex) {
  const words = fixtureWords(text);
  if (!words.length) {
    // Punctuation-only "sentence": a single undifferentiated blip, no words.
    return { pcm: tonePcm(pitchFor(sentenceIndex, 0), WORD_MS * 2), words: [] };
  }
  const parts = [];
  const events = [];
  let cursorMs = 0;
  words.forEach((word, wi) => {
    parts.push(tonePcm(pitchFor(sentenceIndex, wi), WORD_MS));
    events.push({
      text: word.text,
      // Ticks from the sentence start, like a WordBoundary chunk.
      offset: Math.round(cursorMs * TICKS_PER_MS),
      duration: Math.round(WORD_MS * TICKS_PER_MS),
    });
    cursorMs += WORD_MS;
    if (wi < words.length - 1) {
      parts.push(silencePcm(WORD_GAP_MS));
      cursorMs += WORD_GAP_MS;
    }
  });
  return { pcm: Buffer.concat(parts), words: events };
}
