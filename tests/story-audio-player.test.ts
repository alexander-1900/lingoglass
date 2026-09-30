import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SENTENCE_GAP_MS, TIMING_VERSION } from "../scripts/lib/audio-format.mjs";

// StoryAudio drives playback from an <audio> element that jsdom-less vitest has
// no notion of, so these tests install a minimal fake element + rAF and drive
// its events by hand. This is the only way to prove the sentence highlight
// tracks the playhead (the whole point of Phase 2) without a browser.

const TEXTS = ["Una.", "Dos.", "Tres."];
const SPEECH_MS = 1000;
/** Spoken-word duration inside each sentence (shorter than the sentence). */
const WORD_MS = 400;
const STEP = SPEECH_MS + SENTENCE_GAP_MS;

class FakeAudio {
  currentTime = 0;
  paused = true;
  ended = true;
  readyState = 0;
  preload = "";
  src = "";
  playbackRate = 1;
  plays = 0;
  pauses = 0;
  loads = 0;
  aborted = false;
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, cb: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  removeEventListener(type: string, cb: () => void): void {
    this.listeners.get(type)?.delete(cb);
  }

  emit(type: string): void {
    this.listeners.get(type)?.forEach((cb) => cb());
  }

  load(): void {
    this.loads += 1;
  }

  play(): Promise<void> {
    this.paused = false;
    this.ended = false;
    this.plays += 1;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.pauses += 1;
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.src = "";
      this.aborted = true;
    }
  }
}

let elements: FakeAudio[] = [];
let frames: FrameRequestCallback[] = [];

function timingJson() {
  return {
    version: TIMING_VERSION,
    lang: "es",
    voice: "es-ES-AlvaroNeural",
    sampleRate: 24000,
    gapMs: SENTENCE_GAP_MS,
    durationMs: TEXTS.length * STEP - SENTENCE_GAP_MS,
    sentences: TEXTS.map((text, i) => ({
      text,
      startMs: i * STEP,
      endMs: i * STEP + SPEECH_MS,
      // One boundary covering the whole sentence, as the voice would emit for a
      // short sentence — enough to exercise word playback.
      words: [
        {
          text,
          startMs: i * STEP,
          endMs: i * STEP + WORD_MS,
          charStart: 0,
          charEnd: text.length,
        },
      ],
    })),
  };
}

const ENTRY = {
  mp3: "/audio/es/x.deadbeef.mp3",
  timing: "/audio/es/x.deadbeef.json",
  duration: 2750,
};

function stubNetwork(routes: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = routes[url];
      return { ok: body !== undefined, json: async () => body };
    })
  );
}

/** Run N animation frames, including ones a callback registers. */
function runFrames(count = 1): void {
  for (let i = 0; i < count; i += 1) {
    const queue = frames;
    frames = [];
    queue.forEach((cb) => cb(0));
  }
}

async function loadStory(routes?: Record<string, unknown>) {
  vi.resetModules(); // fresh module caches: loadManifest() memoises per instance
  if (routes) stubNetwork(routes); // override the happy-path routes from beforeEach
  const mod = await import("../lib/story-audio");
  return mod.StoryAudio.load({ lang: "es", slug: "x", texts: TEXTS });
}

beforeEach(() => {
  elements = [];
  frames = [];
  const AudioCtor = function (this: unknown) {
    const el = new FakeAudio();
    elements.push(el);
    return el;
  };
  vi.stubGlobal("window", {
    Audio: AudioCtor,
    requestAnimationFrame: (cb: FrameRequestCallback) => frames.push(cb),
    cancelAnimationFrame: () => {},
  });
  stubNetwork({
    "/audio/manifest.json": { "es/x": ENTRY },
    [ENTRY.timing]: timingJson(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StoryAudio.load", () => {
  it("builds a controller when manifest and timings match the story", async () => {
    const story = await loadStory();
    expect(story).not.toBeNull();
    expect(story?.mp3Url).toBe(ENTRY.mp3);
    expect(story?.sentenceCount).toBe(TEXTS.length);
    expect(elements[0].src).toBe(ENTRY.mp3);
    expect(elements[0].preload).toBe("metadata"); // no 700 KB download on open
  });

  it("returns null when the manifest is missing (audio not generated)", async () => {
    expect(await loadStory({ [ENTRY.timing]: timingJson() })).toBeNull();
  });

  it("returns null when the audio narrates different words than the story", async () => {
    const stale = timingJson();
    stale.sentences[2].text = "Cuatro."; // story edited, MP3 not regenerated
    const story = await loadStory({
      "/audio/manifest.json": { "es/x": ENTRY },
      [ENTRY.timing]: stale,
    });
    expect(story).toBeNull();
  });

  it("returns null when this story has no entry", async () => {
    const story = await loadStory({
      "/audio/manifest.json": { "ja/01-momotaro": ENTRY },
      [ENTRY.timing]: timingJson(),
    });
    expect(story).toBeNull();
  });
});

describe("StoryAudio playback", () => {
  it("seeks to the sentence start and reports it immediately", async () => {
    const story = await loadStory();
    const el = elements[0];
    const seen: number[] = [];
    story?.onIndex((i) => seen.push(i));

    story?.playFrom(1);

    expect(el.currentTime).toBe(STEP / 1000); // sentence 1 starts at 1.25 s
    expect(el.plays).toBe(1);
    expect(seen).toEqual([1]);
  });

  it("keeps the finished sentence highlighted through the gap", async () => {
    const story = await loadStory();
    const el = elements[0];
    const seen: number[] = [];
    story?.onIndex((i) => seen.push(i));
    story?.playFrom(0);

    el.currentTime = 0.9; // inside sentence 0
    runFrames();
    el.currentTime = 1.1; // the 250 ms silence that follows it
    runFrames();
    expect(seen).toEqual([0]); // no premature jump

    el.currentTime = 1.25; // sentence 1 begins
    runFrames();
    expect(seen).toEqual([0, 1]);
  });

  it("clamps out-of-range indices and honours the live rate", async () => {
    const story = await loadStory();
    const el = elements[0];
    story?.setRate(0.75);
    expect(el.playbackRate).toBe(0.75);

    story?.playFrom(99);
    expect(story?.currentSentence).toBe(TEXTS.length - 1);
    expect(el.currentTime).toBe((2 * STEP) / 1000);
  });

  it("reports the last sentence when the file ends", async () => {
    const story = await loadStory();
    const el = elements[0];
    const seen: number[] = [];
    let ended = 0;
    story?.onIndex((i) => seen.push(i));
    story?.onEnded(() => {
      ended += 1;
    });

    story?.playFrom(2);
    el.currentTime = 2.75; // past the final start
    el.emit("ended");

    expect(ended).toBe(1);
    expect(seen[seen.length - 1]).toBe(2);
  });

  it("signals errors so the reader can fall back to Web Speech", async () => {
    const story = await loadStory();
    let errored = 0;
    story?.onError(() => {
      errored += 1;
    });
    elements[0].emit("error");
    expect(errored).toBe(1);
  });

  it("stops the loop and aborts the download on dispose", async () => {
    const story = await loadStory();
    const el = elements[0];
    story?.playFrom(0);
    story?.dispose();

    expect(el.pauses).toBeGreaterThanOrEqual(1);
    expect(el.aborted).toBe(true);
    expect(el.loads).toBeGreaterThanOrEqual(1); // src removed → load() aborts

    const seen: number[] = [];
    story?.onIndex((i) => seen.push(i));
    el.currentTime = 2;
    runFrames(3);
    expect(seen).toEqual([]); // nothing fires after dispose
  });
});

describe("StoryAudio word segments (Phase 3 taps)", () => {
  it("plays just the tapped boundary and stops at its end", async () => {
    const story = await loadStory();
    const el = elements[0];

    expect(story?.playWord(1, 0, 3)).toBe(true);
    expect(el.plays).toBe(1);
    expect(el.currentTime).toBe(STEP / 1000); // the sentence start, not 0
    expect(story?.currentSentence).toBe(1); // highlight stays on that sentence

    el.currentTime = (STEP + WORD_MS + 60) / 1000; // boundary end + tail
    runFrames();
    expect(el.paused).toBe(true);
    expect(story?.isPlaying).toBe(false);
  });

  it("plays on when the story itself resumes (segment limit is cleared)", async () => {
    const story = await loadStory();
    const el = elements[0];

    story?.playWord(0, 0, 3);
    story?.playFrom(2); // user pressed Play: the whole story, not one word
    el.currentTime = 2.2;
    runFrames(3);
    expect(el.paused).toBe(false);
  });

  it("returns false so the caller falls back to the device voice", async () => {
    const story = await loadStory();
    const el = elements[0];

    expect(story?.playWord(0, 50, 52)).toBe(false); // no boundary covers it
    expect(story?.playWord(9, 0, 3)).toBe(false); // no such sentence
    expect(el.plays).toBe(0);
  });
});
