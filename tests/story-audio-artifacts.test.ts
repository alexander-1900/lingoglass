import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isEntryUsable, isTimingUsable } from "../lib/story-audio";
import type { StoryAudioEntry, StoryAudioTiming } from "../lib/story-audio";
import { parseSentences } from "../scripts/lib/story-format.mjs";
import { TIMING_VERSION } from "../scripts/lib/audio-format.mjs";
import { FIXTURE_VOICE } from "../scripts/lib/audio-fixture.mjs";

// Everything above lib/story-audio.ts: the FILES the reader fetches. A manifest
// entry that 404s, a timing JSON that drifted from the markdown, or beep audio
// that forgot to call itself beep audio all degrade the reader *silently* (the
// guards in lib/story-audio.ts deliberately fail closed), so the artifacts
// themselves get checked here instead.
//
// Skipped when nothing has been generated yet — `npm test` must never need
// Python, edge-tts or ffmpeg. Run `npm run audio:fixture` to exercise it locally.

const AUDIO = path.join(process.cwd(), "public", "audio");
const MANIFEST = path.join(AUDIO, "manifest.json");
const hasAudio = existsSync(MANIFEST);
const manifest: Record<string, StoryAudioEntry> = hasAudio
  ? JSON.parse(readFileSync(MANIFEST, "utf-8"))
  : {};
const entries = Object.entries(manifest);

const check = hasAudio ? describe : describe.skip;

/** `/audio/es/x.mp3` → `<root>/public/audio/es/x.mp3` */
function localFile(url: string): string {
  return path.join(process.cwd(), "public", decodeURI(url.replace(/^\//, "")));
}

/** The narrated sentences of the story this key belongs to, or null if gone. */
function contentSentences(key: string): string[] | null {
  const [lang, slug] = key.split("/");
  const dir = path.join(process.cwd(), "content", lang);
  if (!slug || !existsSync(dir)) return null;
  for (const level of readdirSync(dir)) {
    const file = path.join(dir, level, `${slug}.md`);
    if (existsSync(file)) return parseSentences(readFileSync(file, "utf-8"));
  }
  return null;
}

function readTiming(entry: StoryAudioEntry): StoryAudioTiming {
  return JSON.parse(readFileSync(localFile(entry.timing), "utf-8")) as StoryAudioTiming;
}

check("generated audio artifacts (public/audio)", () => {
  it("manifest lists at least one story", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("every entry is usable and its files are on disk", () => {
    for (const [key, entry] of entries) {
      expect(isEntryUsable(entry), key).toBe(true);
      expect(existsSync(localFile(entry.mp3)), `${key}: missing ${entry.mp3}`).toBe(true);
      expect(existsSync(localFile(entry.timing)), `${key}: missing ${entry.timing}`).toBe(true);
      // Any real MP3 of a whole story is far bigger than this; a truncated copy
      // (LFS pointer, aborted write) is what the reader cannot recover from.
      expect(readFileSync(localFile(entry.mp3)).length, `${key}: suspiciously small MP3`).toBeGreaterThan(1024);
    }
  });

  it("no entry points at a story that content/ no longer has", () => {
    for (const [key] of entries)
      expect(
        contentSentences(key),
        `${key}: stale manifest entry (story deleted/renamed) — re-run npm run audio:generate`
      ).not.toBeNull();
  });

  it("each timing JSON still matches its story text, version and duration", () => {
    for (const [key, entry] of entries) {
      const timing = readTiming(entry);
      const texts = contentSentences(key) as string[];
      expect(timing.version, key).toBe(TIMING_VERSION);
      expect(timing.lang, key).toBe(key.split("/")[0]);
      expect(
        isTimingUsable(timing, texts),
        `${key}: audio does not match the current text — re-run npm run audio:generate`
      ).toBe(true);
      expect(entry.duration, key).toBe(Math.round(timing.durationMs));
      // Fixture (beep) audio must always announce itself: the reader's badge is
      // driven by entry.fixture, the generator writes it from the voice name.
      expect(timing.voice === FIXTURE_VOICE, `${key}: entry.fixture and voice disagree`).toBe(
        entry.fixture === true
      );
    }
  });

  it("sentence windows and word ranges are self-consistent", () => {
    for (const [key, entry] of entries) {
      const timing = readTiming(entry);
      let previousEnd = 0;
      timing.sentences.forEach((sentence, i) => {
        const at = `${key}#${i + 1}`;
        expect(sentence.startMs, `${at}: starts before the previous sentence`).toBeGreaterThanOrEqual(
          previousEnd
        );
        expect(sentence.endMs, at).toBeGreaterThanOrEqual(sentence.startMs);
        previousEnd = sentence.endMs;
        for (const word of sentence.words) {
          // Word times are absolute story time (the generator offsets them).
          expect(word.startMs, `${at}: word before its sentence`).toBeGreaterThanOrEqual(
            sentence.startMs
          );
          expect(word.endMs, `${at}: word after its sentence`).toBeLessThanOrEqual(sentence.endMs);
          if (word.charStart !== undefined && word.charEnd !== undefined) {
            // The aligned range must slice back to the event's own text — an
            // alignment that matched the wrong occurrence of a repeated word
            // breaks exactly here.
            expect(sentence.text.slice(word.charStart, word.charEnd), `${at}: ${word.text}`).toBe(
              word.text
            );
          }
        }
      });
      expect(timing.durationMs, `${key}: duration short of last sentence`).toBeGreaterThanOrEqual(
        previousEnd
      );
    }
  });
});
