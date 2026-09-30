// Pure audio-timing math shared by the generation script
// (scripts/generate-audio.mjs), the committed timing JSON layout and — from
// Phase 2 — the client controller (lib/story-audio.ts). No Node built-ins and
// no I/O live here so a Node script AND the browser bundle can import it, and
// vitest can test the math directly (tests/audio-format.test.ts).

/**
 * Fixed audio format everywhere: 24 kHz mono, 16-bit PCM. edge-tts answers with
 * 48 kbps CBR MP3 at exactly this rate, so BOTH the MP3 bytes (6 B/ms) and the
 * decoded PCM (48 B/ms) are clocks on the same 48 ms frame grid — which is what
 * lets sentence timings come from byte lengths instead of player estimates.
 */
export const AUDIO_SAMPLE_RATE = 24000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_BITS_PER_SAMPLE = 16;

/** 24000 samples/s × 1 ch × 2 bytes = exactly 48 bytes per millisecond. */
export const AUDIO_BYTES_PER_MS =
  (AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * (AUDIO_BITS_PER_SAMPLE / 8)) / 1000;

/** Silence the generator inserts between sentences. The same window is a
 *  "gap" client-side: it belongs to the sentence it follows. */
export const SENTENCE_GAP_MS = 250;

/** SDK-style word events (edge-tts too) are in 100-nanosecond ticks. */
export const TICKS_PER_MS = 10_000;

/**
 * Version stamp of the timing-JSON shape; bump when the layout changes so a
 * stale committed JSON is regenerated instead of misread. v3 is the edge-tts
 * shape: the JSON records the speaking `rate`, and words carry only the
 * character ranges recovered by alignWords (edge-tts sends no character
 * offsets, so v2's textOffset/wordLength/wordOffsetUnit are gone). Anything
 * older fails lib/story-audio.ts's version check and falls back to the device
 * voice until `npm run audio:generate` rewrites it.
 */
export const TIMING_VERSION = 3;

/** PCM byte counts and ticks both produce long decimals; generator and client
 *  round identically through this. @param {number} n */
export function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/** @param {number} bytes PCM byte count at the fixed output format */
export function pcmBytesToMs(bytes) {
  return bytes / AUDIO_BYTES_PER_MS;
}

/**
 * Byte length → ms for the MP3 the service returns: 48 kbps CBR is 6000
 * bytes/s, so 6 bytes per millisecond. Same clock as the PCM above at 1/8 the
 * byte rate (48 kbps vs 384 kbps), which is what makes a frame-level join
 * possible — 288 MP3 bytes and 2304 PCM bytes are both exactly one 48 ms frame.
 * @param {number} bytes
 */
export function mp3BytesToMs(bytes) {
  return bytes / 6;
}

/** @param {number} ticks 100-ns ticks (edge-tts offset / duration) */
export function ticksToMs(ticks) {
  return ticks / TICKS_PER_MS;
}

/**
 * Lay sentences back-to-back with SENTENCE_GAP_MS of silence between them.
 * Start/end come from EXACT PCM byte lengths (sample-accurate — never from
 * ffprobe or player estimates). The PCM is what the sentence MP3s decode to, so
 * these offsets are also where the voice's own word events land: 48 kbps CBR
 * puts one 1152-sample frame every 288 MP3 bytes = 2304 PCM bytes = 48 ms, so
 * both timelines share one grid.
 * @param {number[]} pcmByteLengths per-sentence PCM byte count, in order
 * @returns {{ startMs: number, endMs: number }[]}
 */
export function sentenceTimings(pcmByteLengths) {
  const out = [];
  let cursor = 0;
  pcmByteLengths.forEach((bytes, i) => {
    const startMs = cursor;
    const endMs = startMs + pcmBytesToMs(bytes);
    out.push({ startMs: round3(startMs), endMs: round3(endMs) });
    cursor = i < pcmByteLengths.length - 1 ? endMs + SENTENCE_GAP_MS : endMs;
  });
  return out;
}

/**
 * One edge-tts WordBoundary event → timing-JSON word shifted into story time.
 * Only the audio offsets are converted (ticks → ms, re-based onto the sentence
 * start); the character span comes from alignWords, because the protocol carries
 * timing but no character offset. Segmentation stays the voice's own — it
 * differs from the Sudachi/Spanish tokens the reader renders, so a tapped word
 * is matched to a boundary by range, client-side.
 * @param {{ text: string, offset: number, duration: number }} raw
 * @param {number} sentenceStartMs
 * @param {{ charStart: number, charEnd: number } | null} [range]
 */
export function wordTiming(raw, sentenceStartMs, range = null) {
  return {
    text: raw.text,
    startMs: round3(sentenceStartMs + ticksToMs(raw.offset)),
    endMs: round3(sentenceStartMs + ticksToMs(raw.offset + raw.duration)),
    ...(range ? { charStart: range.charStart, charEnd: range.charEnd } : {}),
  };
}

/**
 * Recover the character range of every word event: edge-tts reports WHEN a word
 * is spoken, never WHERE it sits in the text, so the span a word tap needs is
 * recovered here, at generation time, by walking the sentence once in event
 * order and taking each boundary from just after the previous match. That is
 * what keeps a repeated word ("no … no") on its own occurrence instead of
 * snapping every event back to the first copy.
 *
 * Matching is exact UTF-16 `indexOf`, the same unit the client indexes in, so a
 * surrogate pair (𠮟 in a Japanese sentence) correctly occupies two units. If the
 * service ever folds a word (case, a stripped clitic), one length-checked
 * case-insensitive retry rescues it; anything still unfound keeps a null range
 * and its tap falls back to the sentence / device voice.
 *
 * @param {string} text the sentence exactly as it was synthesized
 * @param {{ text?: string }[]} words word events, in the order they were spoken
 * @returns {{ matched: number, total: number, ranges: ({ charStart: number, charEnd: number } | null)[] }}
 */
export function alignWords(text, words) {
  const lowered = text.toLowerCase();
  let cursor = 0;
  let matched = 0;
  const ranges = words.map((word) => {
    const needle = typeof word.text === "string" ? word.text : "";
    if (!needle) return null;
    let at = text.indexOf(needle, cursor); // forward scan: repeated words stay apart
    if (at < 0) at = text.indexOf(needle); // …unless the event arrived out of order
    if (at < 0) at = foldIndex(lowered, text, needle, cursor);
    if (at < 0) return null;
    cursor = at + needle.length;
    matched += 1;
    return { charStart: at, charEnd: cursor };
  });
  return { matched, total: words.length, ranges };
}

/**
 * Case-insensitive indexOf, but only when folding cannot move an index: if
 * toLowerCase changed the length of either string (İ → i̇), the offsets no longer
 * line up with the original text and a match would be a lie.
 * @param {string} lowered @param {string} text @param {string} needle @param {number} from
 */
function foldIndex(lowered, text, needle, from) {
  if (lowered.length !== text.length) return -1;
  const folded = needle.toLowerCase();
  if (folded.length !== needle.length) return -1;
  return lowered.indexOf(folded, from);
}

/**
 * Index of the sentence covering `timeMs`: the LAST sentence that has started,
 * so the 250 ms silence regions belong to the sentence they follow (the UI
 * keeps the finished line highlighted through the pause). Before the first
 * start and past the end, the first/last sentence wins. Binary search because
 * this runs from rAF on every frame.
 * @param {number} timeMs
 * @param {{ startMs: number, endMs: number }[]} timings
 * @returns {number} index, or -1 when there are no sentences
 */
export function sentenceIndexAt(timeMs, timings) {
  if (!timings.length) return -1;
  let lo = 0;
  let hi = timings.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeMs >= timings[mid].startMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Public filenames for one story revision. @param {string} slug @param {string} hash8 */
export function storyFileNames(slug, hash8) {
  return { mp3: `${slug}.${hash8}.mp3`, timing: `${slug}.${hash8}.json` };
}

/**
 * Files in an output dir left over from an older content hash of this slug.
 * @param {string[]} dirNames
 * @param {string} slug
 * @param {string} hash8
 * @returns {string[]}
 */
export function staleStoryFiles(dirNames, slug, hash8) {
  const keep = new Set(Object.values(storyFileNames(slug, hash8)));
  return dirNames.filter(
    (n) => n.startsWith(`${slug}.`) && (n.endsWith(".mp3") || n.endsWith(".json")) && !keep.has(n)
  );
}

/** Manifest record for one story (URLs absolute from the site root).
 *  @param {boolean} [fixture] true for locally synthesized beep audio — the
 *  client shows it as test audio instead of studio narration. */
export function manifestEntry(lang, slug, hash8, durationMs, fixture = false) {
  const { mp3, timing } = storyFileNames(slug, hash8);
  return {
    mp3: `/audio/${lang}/${mp3}`,
    timing: `/audio/${lang}/${timing}`,
    duration: Math.round(durationMs),
    ...(fixture ? { fixture: true } : {}),
  };
}

/** Does an existing manifest record already point at this hash's files? */
export function manifestEntryMatches(entry, slug, hash8) {
  if (!entry) return false;
  const { mp3, timing } = storyFileNames(slug, hash8);
  return entry.mp3.endsWith(`/${mp3}`) && entry.timing.endsWith(`/${timing}`);
}
