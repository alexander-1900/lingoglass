"use client";

import { SEPARATORS } from "./glossary";

const LANG_VOICES: Record<string, string[]> = {
  es: ["es-ES", "es-MX", "es"],
  ru: ["ru-RU", "ru"],
  ja: ["ja-JP", "ja"],
};

/** Emptiness guard for word taps — same separator class as the reader. */
const SEPARATOR_RE = new RegExp(`[${SEPARATORS}]+`, "g");

let voicesCache: SpeechSynthesisVoice[] = [];
// Shared in-flight load so concurrent callers await ONE load (and later
// callers get the settled list instantly). Without memoization, every tap
// started its own 1.5s fallback race and `speak()` could run against an
// empty cache → the OS default (often English) voice for ES/RU/JA text.
// IMPORTANT: a load that settles EMPTY drops the memo (voicesPromise = null)
// so the next caller retries — some platforms (iOS) expose voices only after
// a late `voiceschanged`, and a permanently cached empty promise would pin
// the app to the OS default voice forever.
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesPromise) return voicesPromise;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return Promise.resolve([]);
  }
  voicesPromise = new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    // Hoisted function declarations: `finish` can run before `voiceschanged`
    // ever attaches (cached-voices fast path) and the listener can fire
    // before the fallback timer — both directions must resolve cleanly.
    function onVoicesChanged(): void {
      finish(window.speechSynthesis.getVoices());
    }
    // Single exit: refresh the cache, clear the timer AND the listener (no
    // listener pile-up across retries), then resolve.
    function finish(voices: SpeechSynthesisVoice[]): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      voicesCache = voices;
      if (!voices.length) voicesPromise = null;
      resolve(voices);
    }
    // Some platforms never fire onvoiceschanged — never hang forever.
    timer = window.setTimeout(() => finish(window.speechSynthesis.getVoices()), 1500);
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      finish(existing);
      return;
    }
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
  });
  return voicesPromise;
}

/**
 * Await the voice list without ever blocking interaction for long. Callers
 * that must pick a voice before the first utterance (first word tap, story
 * playback start) race the load against this short cap. Once voices are
 * cached, `loadVoices()` resolves in a microtask — no perceptible delay.
 */
export async function ensureVoices(): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    await Promise.race([
      loadVoices(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 800)),
    ]);
  } catch {
    /* speech engine unavailable — speak() still works via utter.lang */
  }
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const prefixes = LANG_VOICES[lang] ?? [lang];
  // Device default for the language: first installed voice that matches —
  // no gender/name filtering (the engine's own default ordering is what
  // the user hears as "the default voice").
  return voicesCache.find((v) =>
    prefixes.some((p) => v.lang.toLowerCase().startsWith(p))
  );
}

/** Shared utterance setup for word taps and story playback. */
function makeUtterance(text: string, lang: string, rate: number): SpeechSynthesisUtterance {
  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(lang);
  if (voice) utter.voice = voice;
  utter.lang = voice?.lang ?? LANG_VOICES[lang]?.[0] ?? lang;
  utter.rate = rate;
  return utter;
}

/**
 * cancel → speak drops the utterance when the engine is wedged in `paused`
 * (Chrome after a cancel/long read: the next speak() never starts — "play
 * button does nothing"). Un-wedge first, then queue. Shared by word taps and
 * story playback so both paths get the same reliability.
 */
function queueSpeak(utter: SpeechSynthesisUtterance): void {
  const s = window.speechSynthesis;
  s.cancel(); // defensive: drop any stray/coalesced utterance
  if (s.paused) s.resume();
  s.speak(utter);
}

// Browser timer handle (DOM setTimeout returns a number).
let speakTimer: number | undefined;

/** Drop a word-tap utterance that hasn't sounded yet (stop / new run). */
export function cancelPendingSpeak(): void {
  if (typeof window !== "undefined" && speakTimer !== undefined) {
    window.clearTimeout(speakTimer);
    speakTimer = undefined;
  }
}

/** Speak text with the OS voice (no external TTS service). */
export function speak(text: string, lang: string, rate = 0.9): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!text.replace(SEPARATOR_RE, "")) return;
  // Chrome drops an utterance queued in the same task as cancel(): cancel
  // now, queue the utterance on the next beat. Coalesce rapid taps so only
  // the latest word sounds.
  window.speechSynthesis.cancel();
  if (speakTimer) window.clearTimeout(speakTimer);
  speakTimer = window.setTimeout(() => {
    speakTimer = undefined;
    queueSpeak(makeUtterance(text, lang, rate));
  }, 40);
}

/**
 * Promise-based speak for story playback. Resolves when the utterance ends
 * (or errors), rejects nothing — always resolves so loops can't hang.
 * Reads `getRate()` per call so speed changes apply mid-story.
 */
export function speakAsync(
  text: string,
  lang: string,
  getRate: () => number,
  signal: { cancelled: boolean }
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    if (signal.cancelled || !text.trim()) {
      resolve();
      return;
    }
    const utter = makeUtterance(text, lang, getRate());
    let done = false;
    // Holder object rather than two `let`s: the timers are assigned AFTER
    // `finish` is defined (finish clears them, they call finish), which is
    // a circular init a plain const can't express.
    const timers: {
      timeout?: ReturnType<typeof setTimeout>;
      kick?: ReturnType<typeof setTimeout>;
    } = {};
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timers.timeout);
      clearTimeout(timers.kick);
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    // Safety net: some platforms never fire onend for long utterances.
    // Scaled from text length and live rate (~8 chars/sec at 0.5x): a 200-char
    // C2 sentence needs ~25s at 1x but ~50s at 0.5x. Normal onend still wins
    // immediately; this only bounds a truly hung engine (floor 30s, cap 120s).
    const rate = utter.rate > 0 ? utter.rate : 1;
    const safetyMs = Math.min(
      120_000,
      Math.max(30_000, Math.ceil((text.trim().length * 120) / rate))
    );
    timers.timeout = setTimeout(finish, safetyMs);
    // Same Chrome cancel-then-speak race as speak(): defer the kick, and
    // don't start at all if a stop landed in the meantime.
    timers.kick = setTimeout(() => {
      if (signal.cancelled) {
        finish();
        return;
      }
      queueSpeak(utter);
    }, 40);
  });
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
