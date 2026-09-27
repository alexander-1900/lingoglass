import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the voice-list memoization: a load that settles EMPTY
 * must not pin the app to an empty voicesCache forever (iOS exposes voices
 * only after a late `voiceschanged`), and every settle must remove its
 * listener + fallback timer so retries can't leak listeners.
 */

interface FakeSynth {
  voices: { name: string; lang: string }[];
  listeners: Array<() => void>;
  getVoices(): { name: string; lang: string }[];
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
}

function installWindow(): FakeSynth {
  const synth: FakeSynth = {
    voices: [],
    listeners: [],
    getVoices() {
      return this.voices;
    },
    addEventListener(_type, cb) {
      this.listeners.push(cb);
    },
    removeEventListener(_type, cb) {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    },
  };
  const win = {
    speechSynthesis: {
      ...synth,
      getVoices: () => synth.getVoices(),
      addEventListener: (_t: string, cb: () => void) => synth.addEventListener(_t, cb),
      removeEventListener: (_t: string, cb: () => void) => synth.removeEventListener(_t, cb),
      cancel() {},
      speak() {},
    },
    // Delegate at call time so vi.useFakeTimers() applies.
    setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
    clearTimeout: (...a: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...a),
  };
  vi.stubGlobal("window", win);
  return synth;
}

describe("tts voice loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules(); // fresh voicesPromise per test
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries after an empty settle instead of caching [] forever", async () => {
    const synth = installWindow();
    const tts = await import("../lib/tts");

    // First load: platform reports no voices yet → waits, then times out.
    const p1 = tts.loadVoices();
    expect(synth.listeners.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1600);
    expect(await p1).toEqual([]);
    expect(synth.listeners.length).toBe(0); // listener cleaned up on settle

    // Voices appear later — the NEXT caller must re-query, not reuse [].
    synth.voices = [{ name: "Ana", lang: "es-ES" }];
    const p2 = tts.loadVoices();
    expect(await p2).toHaveLength(1);
    expect(synth.listeners.length).toBe(0); // fast path, no dangling listener
  });

  it("resolves immediately when voices are already cached and memoizes while non-empty", async () => {
    const synth = installWindow();
    synth.voices = [{ name: "Ana", lang: "es-ES" }];
    const tts = await import("../lib/tts");
    expect(await tts.loadVoices()).toHaveLength(1);
    expect(synth.listeners.length).toBe(0);
    expect(await tts.loadVoices()).toHaveLength(1);
  });

  it("a late voiceschanged wins over the fallback timer and cleans up", async () => {
    const synth = installWindow();
    const tts = await import("../lib/tts");
    const p = tts.loadVoices();
    synth.voices = [{ name: "Boris", lang: "ru-RU" }];
    synth.listeners.slice().forEach((cb) => cb());
    expect(await p).toHaveLength(1);
    expect(synth.listeners.length).toBe(0);
    await vi.advanceTimersByTimeAsync(2000); // stale timer must be a no-op
  });
});

/**
 * Regression tests for the deferred-utterance lifecycle: a deferral that is
 * dropped (Stop pressed, or superseded by a newer sentence) must settle its
 * speakAsync promise at once — otherwise the playback loop waits on the
 * 30–120s safety timer. Plus the platform guards: a browser that exposes
 * `speechSynthesis` without the `SpeechSynthesisUtterance` constructor must
 * never reach `new SpeechSynthesisUtterance` (it threw ReferenceError inside
 * the tap handler), and engine throws must not escape into React handlers.
 */

class FakeUtterance {
  text: string;
  lang = "";
  rate = 1;
  voice?: unknown;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

interface FakeEngine {
  spoken: FakeUtterance[];
  speaking: boolean;
  pending: boolean;
  cancelThrows: boolean;
  speakThrows: boolean;
  cancelCount: number;
}

/** Engine stand-in. `speaking = true` forces queueSpeak's 80ms deferral path. */
function installEngine(withUtteranceCtor = true): FakeEngine {
  const engine: FakeEngine = {
    spoken: [],
    speaking: false,
    pending: false,
    cancelThrows: false,
    speakThrows: false,
    cancelCount: 0,
  };
  vi.stubGlobal("window", {
    speechSynthesis: {
      get speaking() {
        return engine.speaking;
      },
      get pending() {
        return engine.pending;
      },
      paused: false,
      getVoices: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      speak: (u: FakeUtterance) => {
        if (engine.speakThrows) throw new Error("engine refused");
        engine.spoken.push(u);
      },
      cancel: () => {
        engine.cancelCount += 1;
        if (engine.cancelThrows) throw new Error("cancel refused");
      },
      resume: () => {},
    },
    // Delegate at call time so vi.useFakeTimers() applies.
    setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
    clearTimeout: (...a: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...a),
  });
  if (withUtteranceCtor) vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return engine;
}

describe("tts deferred utterance lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules(); // fresh deferral state per test
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("settles a story utterance whose deferral is dropped by Stop", async () => {
    const engine = installEngine();
    const tts = await import("../lib/tts");
    engine.speaking = true; // busy -> queueSpeak parks the utterance
    const signal = { cancelled: false };
    let settled = false;
    void tts
      .speakAsync("Hola mundo.", "es", () => 1, signal)
      .then(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(40); // kick fires -> busy -> parked
    expect(engine.spoken).toHaveLength(0);

    engine.speaking = false;
    signal.cancelled = true;
    tts.cancelPendingSpeak(); // Stop pressed inside the deferral window

    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(true); // pre-fix: only the 30s safety timer freed it
    expect(engine.spoken).toHaveLength(0); // a dropped utterance never sounds
  });

  it("settles the superseded promise when a newer sentence coalesces the queue", async () => {
    const engine = installEngine();
    const tts = await import("../lib/tts");
    engine.speaking = true;
    let first = false;
    void tts
      .speakAsync("one", "es", () => 1, { cancelled: false })
      .then(() => {
        first = true;
      });
    await vi.advanceTimersByTimeAsync(40); // "one" parked
    void tts.speakAsync("two", "es", () => 1, { cancelled: false });
    await vi.advanceTimersByTimeAsync(60); // "two" kicks -> takes the deferral
    expect(first).toBe(true);
    await vi.advanceTimersByTimeAsync(120);
    expect(engine.spoken.map((u) => u.text)).toEqual(["two"]);
  });

  it("settles immediately when the engine refuses to speak (throws)", async () => {
    const engine = installEngine();
    const tts = await import("../lib/tts");
    engine.speakThrows = true;
    let settled = false;
    void tts
      .speakAsync("Hola.", "es", () => 1, { cancelled: false })
      .then(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(60); // idle path -> speakNow threw -> caught
    expect(settled).toBe(true);
  });

  it("never reaches the constructor without SpeechSynthesisUtterance", async () => {
    installEngine(false); // engine present, constructor absent (some WebViews)
    const tts = await import("../lib/tts");
    expect(tts.speakSupported()).toBe(false);
    expect(() => tts.speak("hola", "es", 1)).not.toThrow();
    expect(() => tts.stopSpeaking()).not.toThrow();
    let settled = false;
    void tts
      .speakAsync("hola", "es", () => 1, { cancelled: false })
      .then(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(true); // no run should ever start, so never hang
    tts.cancelPendingSpeak();
  });

  it("survives an engine that throws from cancel() (iOS after voice changes)", async () => {
    const engine = installEngine();
    const tts = await import("../lib/tts");
    engine.cancelThrows = true;
    engine.speaking = true;
    expect(() => tts.speak("hola", "es", 1)).not.toThrow();
    await vi.advanceTimersByTimeAsync(120); // still spoken past the failed cancel
    expect(engine.spoken).toHaveLength(1);
  });
});

