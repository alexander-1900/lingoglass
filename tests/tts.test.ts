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
