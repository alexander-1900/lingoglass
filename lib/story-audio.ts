"use client";

// Pre-generated neural story audio (edge-tts → public/audio MP3 + timing JSON).
//
// The feature is AUTHORING-TIME: scripts/generate-audio.mjs writes
// public/audio/manifest.json plus one {slug}.{hash}.mp3/.json per story, and
// this module plays them. `output: "export"` means there is no server to ask,
// so discovery is a static JSON fetch — and EVERY failure path here returns
// null / fires the error listener so the reader can fall back to the Web Speech
// loop in lib/tts.ts. Studio audio is an enhancement, never a requirement.
//
// Timings come from the JSON the generator derived from exact PCM byte lengths
// (sample-accurate), and the sentence lookup is the SAME function the generator
// uses — imported from scripts/lib/audio-format.mjs, so generator and player
// can never disagree about where a sentence starts.

// Relative (not "@/scripts/…") on purpose: lib/ imports relatively throughout,
// and `vitest run` has no alias config — tests/story-audio.test.ts must be able
// to import this module, and this module must reach the shared timing math.
import { TIMING_VERSION, sentenceIndexAt } from "../scripts/lib/audio-format.mjs";

/** One word the voice reported, shifted into story time (word playback). */
export interface StoryAudioWord {
  text: string;
  startMs: number;
  endMs: number;
  /** Resolved UTF-16 range in the parent sentence's text. The generator recovers
   *  it from the sentence text (the protocol reports timing, not position), and
   *  Phase 3 needs it to map a tapped Sudachi/Spanish token onto the voice's own
   *  segmentation. Absent when the word could not be located — see alignWords. */
  charStart?: number;
  charEnd?: number;
}

export interface StoryAudioSentence {
  /** Sentence text as it was when the audio was synthesized. */
  text: string;
  startMs: number;
  endMs: number;
  words: StoryAudioWord[];
}

export interface StoryAudioTiming {
  version: number;
  lang: string;
  voice: string;
  sampleRate: number;
  gapMs: number;
  durationMs: number;
  sentences: StoryAudioSentence[];
}

/** One manifest record (paths absolute from the site root). */
export interface StoryAudioEntry {
  mp3: string;
  timing: string;
  duration: number;
  /** Locally synthesized TEST audio (scripts/generate-audio.mjs --fixture). */
  fixture?: boolean;
}

/** Which engine the reader is currently driving. */
export type StoryAudioSource = "studio" | "native";

/**
 * A word the reader tapped: the sentence it sits in plus its character range in
 * that sentence's displayed text. That range is what maps a tapped token onto
 * the voice's own segmentation (see wordIndexForChar).
 */
export interface WordTap {
  sentenceIdx: number;
  charStart: number;
  charEnd: number;
  /** The displayed word (punctuation stripped) — used by the device-voice fallback. */
  text: string;
}

const MANIFEST_URL = "/audio/manifest.json";

/** Extra playback past a word boundary's end: the voice's `duration` can end
 *  right on the last phoneme, which clips audibly on a single tapped word. */
const WORD_TAIL_MS = 60;

/** Manifest key for a story — must match scripts/generate-audio.mjs. */
export function storyAudioKey(lang: string, slug: string): string {
  return `${lang}/${slug}`;
}

/**
 * Is this timing JSON usable for exactly these sentences?
 *
 * The text equality is the real staleness guard: the manifest is keyed by
 * lang/slug only, so a story whose text was edited without re-running the
 * generator would otherwise play yesterday's narration under today's highlight.
 * Cheap (one compare per sentence) and runs once per load.
 */
export function isTimingUsable(
  json: unknown,
  texts: readonly string[]
): json is StoryAudioTiming {
  if (!json || typeof json !== "object") return false;
  const t = json as Partial<StoryAudioTiming>;
  if (t.version !== TIMING_VERSION || !Array.isArray(t.sentences)) return false;
  if (t.sentences.length !== texts.length) return false;
  let prev = -1;
  return t.sentences.every((s, i) => {
    if (!s || typeof s.text !== "string" || s.text !== texts[i]) return false;
    if (typeof s.startMs !== "number" || typeof s.endMs !== "number") return false;
    if (!Number.isFinite(s.startMs) || !Number.isFinite(s.endMs)) return false;
    if (s.startMs < prev) return false; // the generator emits ascending starts
    prev = s.startMs;
    return true;
  });
}

/** Shape check for one manifest record before URLs are built from it. */
export function isEntryUsable(entry: unknown): entry is StoryAudioEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Partial<StoryAudioEntry>;
  return (
    typeof e.mp3 === "string" &&
    typeof e.timing === "string" &&
    e.mp3.startsWith("/audio/") &&
    e.timing.startsWith("/audio/")
  );
}

/**
 * Which boundary covers a tapped word's character range in the sentence?
 *
 * The voice segments text its own way (Japanese boundaries are phrase-like and
 * often swallow particles), so the tapped token and the boundary are matched by
 * RANGE, not equality: a boundary that fully contains the tap wins (tapping 桃
 * inside 「桃太郎」 plays the whole phrase — what a learner wants), otherwise the
 * first partial overlap. -1 means no boundary can speak this word.
 *
 * @param sentence one entry of the timing JSON
 * @param charStart inclusive UTF-16 index of the tapped word
 * @param charEnd exclusive UTF-16 index of the tapped word
 */
export function wordIndexForChar(
  sentence: StoryAudioSentence,
  charStart: number,
  charEnd: number
): number {
  let overlap = -1;
  for (let i = 0; i < sentence.words.length; i += 1) {
    const w = sentence.words[i];
    if (!Number.isFinite(w.charStart) || !Number.isFinite(w.charEnd)) continue;
    const start = w.charStart as number;
    const end = w.charEnd as number;
    if (start <= charStart && end >= charEnd) return i; // contains the tap
    if (overlap < 0 && start < charEnd && end > charStart) overlap = i;
  }
  return overlap;
}

// Module-level caches: library → story → library navigation must not refetch
// the manifest on every mount (dev StrictMode double-invokes effects as well).
let manifestPromise: Promise<Record<string, unknown> | null> | null = null;
const timingCache = new Map<string, Promise<StoryAudioTiming | null>>();

function loadManifest(): Promise<Record<string, unknown> | null> {
  if (manifestPromise) return manifestPromise;
  if (typeof window === "undefined") return Promise.resolve(null);
  // A missing manifest (audio not generated yet) is the normal case: cache the
  // null so a story page pays ONE 404 per visit instead of one per mount.
  manifestPromise = fetch(MANIFEST_URL)
    .then((res) => (res.ok ? (res.json() as Promise<Record<string, unknown>>) : null))
    .catch(() => null);
  return manifestPromise;
}

function loadTiming(url: string): Promise<StoryAudioTiming | null> {
  const cached = timingCache.get(url);
  if (cached) return cached;
  const pending = fetch(url)
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => (json && typeof json === "object" ? (json as StoryAudioTiming) : null))
    .catch(() => null);
  timingCache.set(url, pending);
  return pending;
}

/**
 * One story's audio: an <audio> element plus the sentence its playhead is in.
 * Deliberately framework-free — ReaderView subscribes to index/ended/error.
 * Also plays a single word/phrase segment on demand (Phase 3 word taps).
 */
export class StoryAudio {
  readonly mp3Url: string;
  readonly durationMs: number;
  /** True when the files are locally synthesized test audio (--fixture). */
  readonly fixture: boolean;

  private readonly el: HTMLAudioElement;
  private readonly sentences: StoryAudioSentence[];
  private index = 0;
  private raf = 0;
  /** Story-time ms to stop at (word-tap segments); null = play on. */
  private stopAtMs: number | null = null;
  private disposed = false;
  private indexCbs = new Set<(index: number) => void>();
  private endedCbs = new Set<() => void>();
  private errorCbs = new Set<() => void>();

  private constructor(entry: StoryAudioEntry, timing: StoryAudioTiming) {
    this.mp3Url = entry.mp3;
    this.durationMs = timing.durationMs;
    this.fixture = entry.fixture === true;
    this.sentences = timing.sentences;
    this.el = new window.Audio();
    // metadata, not auto: a 2-minute story at 48 kbps is ~700 KB, and
    // downloading it for a reader who never presses Play would be rude.
    // Cloudflare serves Range requests, so mid-story seeks buffer on demand.
    this.el.preload = "metadata";
    this.el.src = entry.mp3;
    this.el.addEventListener("timeupdate", this.sample);
    this.el.addEventListener("ended", this.handleEnded);
    this.el.addEventListener("error", this.handleError);
  }

  /**
   * Resolve manifest → timing → element for one story. Resolves NULL (never
   * rejects) whenever studio audio is missing, broken or untrustworthy.
   */
  static async load(opts: {
    lang: string;
    slug: string;
    texts: readonly string[];
  }): Promise<StoryAudio | null> {
    try {
      if (typeof window === "undefined" || typeof window.Audio !== "function") return null;
      const manifest = await loadManifest();
      if (!manifest) return null;
      const entry = manifest[storyAudioKey(opts.lang, opts.slug)];
      if (!isEntryUsable(entry)) return null;
      const timing = await loadTiming(entry.timing);
      // Validated per call rather than cached-validated: the same URL could be
      // asked for by a story whose text has since changed.
      if (!isTimingUsable(timing, opts.texts)) return null;
      return new StoryAudio(entry, timing);
    } catch {
      return null; // corrupt JSON, offline, aborted fetch → just use Web Speech
    }
  }

  get sentenceCount(): number {
    return this.sentences.length;
  }

  /** Sentence the playhead is inside (gap regions → the sentence before them). */
  get currentSentence(): number {
    return this.index;
  }

  get isPlaying(): boolean {
    return !this.disposed && !this.el.paused && !this.el.ended;
  }

  /**
   * Start (or restart) a sentence. Synchronous up to el.play() so the call
   * stays inside the click handler's user-gesture window (iOS Safari).
   */
  playFrom(sentenceIndex: number): void {
    if (this.disposed || !this.sentences.length) return;
    const i = Math.max(0, Math.min(this.sentences.length - 1, sentenceIndex));
    this.index = i;
    this.emitIndex();
    this.startAt(this.sentences[i].startMs, null);
  }

  /**
   * Play ONE spoken word — a tapped word or the phrase it belongs to — and
   * stop again. The story itself stays paused where it was; nothing advances.
   * @returns false when no boundary covers the tapped character range, so the
   *          caller can fall back to the device voice.
   */
  playWord(sentenceIndex: number, charStart: number, charEnd: number): boolean {
    if (this.disposed) return false;
    const sentence = this.sentences[sentenceIndex];
    if (!sentence) return false;
    const wi = wordIndexForChar(sentence, charStart, charEnd);
    if (wi < 0) return false;
    const word = sentence.words[wi];
    this.index = sentenceIndex;
    this.emitIndex();
    this.startAt(word.startMs, word.endMs + WORD_TAIL_MS);
    return true;
  }

  /** Shared start path: seek, play, and optionally stop at a story-time ms. */
  private startAt(startMs: number, stopAtMs: number | null): void {
    if (this.disposed) return;
    this.stopAtMs = stopAtMs;
    try {
      if (this.el.readyState === 0) this.el.load();
      // Legal before metadata exists — the element queues the seek and applies
      // it as soon as the media loads, which is what makes instant starts work.
      this.el.currentTime = startMs / 1000;
    } catch {
      /* nothing loaded yet — play() starts at 0 and the highlight still tracks */
    }
    const started = this.el.play();
    this.startRaf();
    if (started && typeof started.catch === "function") {
      started.catch((err: unknown) => {
        // pause()/seek racing a pending play() reports AbortError: expected.
        const name = (err as { name?: string } | null)?.name;
        if (name && name !== "AbortError") this.handleError();
      });
    }
  }

  /** Pause in place (the next playFrom re-reads the sentence, as Web Speech does). */
  pause(): void {
    this.stopAtMs = null;
    this.stopRaf();
    try {
      this.el.pause();
    } catch {
      /* already detached */
    }
    this.sample();
  }

  /** Live speed change (browsers preserve pitch on playbackRate by default). */
  setRate(rate: number): void {
    if (this.disposed || !Number.isFinite(rate) || rate <= 0) return;
    try {
      this.el.playbackRate = rate;
    } catch {
      /* engine not ready — the next playFrom applies the attempt */
    }
  }

  onIndex(cb: (index: number) => void): () => void {
    this.indexCbs.add(cb);
    return () => this.indexCbs.delete(cb);
  }

  onEnded(cb: () => void): () => void {
    this.endedCbs.add(cb);
    return () => this.endedCbs.delete(cb);
  }

  onError(cb: () => void): () => void {
    this.errorCbs.add(cb);
    return () => this.errorCbs.delete(cb);
  }

  /** Abort the download and drop every listener (unmount / story change). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopRaf();
    this.el.removeEventListener("timeupdate", this.sample);
    this.el.removeEventListener("ended", this.handleEnded);
    this.el.removeEventListener("error", this.handleError);
    try {
      this.el.pause();
      this.el.removeAttribute("src");
      this.el.load(); // stops an in-flight download in Chrome and Safari
    } catch {
      /* element already torn down */
    }
    this.indexCbs.clear();
    this.endedCbs.clear();
    this.errorCbs.clear();
  }

  private startRaf(): void {
    this.stopRaf();
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      this.raf = window.requestAnimationFrame(this.tick);
    }
  }

  private stopRaf(): void {
    if (this.raf && typeof window !== "undefined") window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Frame loop: timeupdate fires only ~4×/s, far too coarse for 250 ms gaps. */
  private tick = (): void => {
    this.raf = 0;
    if (this.disposed) return;
    this.sample();
    if (this.isPlaying) this.raf = window.requestAnimationFrame(this.tick);
  };

  private sample = (): void => {
    if (this.disposed) return;
    // Word-tap segments stop themselves at the boundary end. Checked here (not
    // in tick) so the timeupdate fallback also honours it in background tabs,
    // where rAF is frozen but the audio keeps playing.
    if (this.stopAtMs !== null && this.el.currentTime * 1000 >= this.stopAtMs) {
      this.pause();
      return;
    }
    const idx = sentenceIndexAt(this.el.currentTime * 1000, this.sentences);
    if (idx >= 0 && idx !== this.index) {
      this.index = idx;
      this.emitIndex();
    }
  };

  private handleEnded = (): void => {
    this.stopRaf();
    this.sample(); // the LAST sentence must be reported before the run ends
    if (this.disposed) return;
    this.endedCbs.forEach((cb) => cb());
  };

  private handleError = (): void => {
    if (this.disposed) return;
    this.stopRaf();
    this.errorCbs.forEach((cb) => cb());
  };

  private emitIndex(): void {
    if (this.disposed) return;
    this.indexCbs.forEach((cb) => cb(this.index));
  }
}
