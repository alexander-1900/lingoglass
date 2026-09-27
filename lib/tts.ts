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
 * Await the voice list without ever blocking interaction for long.
 * Fast path: sync getVoices() — if the platform already has voices, return
 * immediately instead of waiting on the promise race (that wait was up to
 * 800ms of silence before the first sentence on Play).
 */
export async function ensureVoices(): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const now = window.speechSynthesis.getVoices();
    if (now.length) {
      voicesCache = now;
      return;
    }
    await Promise.race([
      loadVoices(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 300)),
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

/**
 * True only when the platform exposes a USABLE Web Speech engine. Some
 * WebViews/derived browsers ship `window.speechSynthesis` without the
 * `SpeechSynthesisUtterance` constructor; checking the former alone threw a
 * ReferenceError inside the reader's tap handler and Play button.
 * Voice-list loading (`loadVoices`/`ensureVoices`) only needs the synth
 * object, so those keep their narrower check.
 */
export function speakSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

/** Run one engine call, swallowing platform throws (iOS/Safari can throw from
 *  speak()/cancel() after a voice change). Returns true when the call was
 *  accepted — callers must treat a false `speak` as a dropped utterance. */
function safeEngine(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
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

// Deferred utterances: Chrome DROPS an utterance queued in the same task as
// cancel() (it errors with "interrupted" or just never sounds — the classic
// "speech doesn't start" bug), so a busy engine is cancelled now and the
// speak happens on a later tick. An IDLE engine must never be cancelled —
// speak directly (instant start, and still inside the user's tap gesture,
// which iOS/Safari requires for the first utterance).
let speakTimer: number | undefined; // word-tap deferral
let deferTimer: number | undefined; // story/queueSpeak deferral
/** Settle callback for the utterance parked in `deferTimer`. A dropped
 *  deferral MUST settle its promise: the only other exit for speakAsync is a
 *  30–120s safety timer, so pressing Stop used to leave the playback loop hung
 *  on an utterance that was cancelled before it ever sounded. */
let deferDropped: (() => void) | null = null;

/** Cancel the pending story utterance and hand back its settle callback (null
 *  when nothing was parked). Whoever takes it must invoke it. */
function takeDeferral(): (() => void) | null {
  if (deferTimer === undefined) return null;
  window.clearTimeout(deferTimer);
  deferTimer = undefined;
  const dropped = deferDropped;
  deferDropped = null;
  return dropped;
}

/** Drop every pending utterance (stop / new run / unmount), settling any story
 *  utterance that will now never sound. */
function clearDeferrals(): void {
  if (speakTimer !== undefined) {
    window.clearTimeout(speakTimer);
    speakTimer = undefined;
  }
  takeDeferral()?.();
}

/** Un-wedge a synthesiser stuck in `paused` (queued speech never starts), then speak.
 *  False = the engine refused or threw, so the caller must treat the utterance
 *  as dropped instead of waiting for an `onend` that can never fire. */
function speakNow(utter: SpeechSynthesisUtterance): boolean {
  const s = window.speechSynthesis;
  if (s.paused) safeEngine(() => s.resume());
  return safeEngine(() => s.speak(utter));
}

function busy(): boolean {
  const s = window.speechSynthesis;
  return s.speaking || s.pending;
}

/**
 * Queue one utterance: instant when idle, cancel + deferred when busy.
 * `onDropped` settles the caller's promise whenever this utterance ends up
 * never sounding — superseded by a newer one, cancelled by a stop, or refused
 * by the engine.
 */
function queueSpeak(utter: SpeechSynthesisUtterance, onDropped?: () => void): void {
  // A newer utterance supersedes the parked one: that one settles now.
  takeDeferral()?.();
  if (busy()) {
    safeEngine(() => window.speechSynthesis.cancel());
    deferDropped = onDropped ?? null;
    deferTimer = window.setTimeout(() => {
      deferTimer = undefined;
      deferDropped = null;
      if (!speakNow(utter)) onDropped?.();
    }, 80);
  } else if (!speakNow(utter)) {
    onDropped?.();
  }
}

/** Drop any pending deferred utterance (stop / new run / unmount). */
export function cancelPendingSpeak(): void {
  if (typeof window === "undefined") return;
  clearDeferrals();
}

/** Speak text with the OS voice (no external TTS service). */
export function speak(text: string, lang: string, rate = 0.9): void {
  if (!speakSupported()) return;
  if (!text.replace(SEPARATOR_RE, "")) return;
  if (speakTimer !== undefined) {
    window.clearTimeout(speakTimer);
    speakTimer = undefined;
  }
  const utter = makeUtterance(text, lang, rate);
  if (busy()) {
    // Something is sounding: cut it, then speak past the cancel on a later
    // tick (same-task cancel+speak gets dropped). Rapid taps coalesce —
    // only the latest word wins.
    safeEngine(() => window.speechSynthesis.cancel());
    speakTimer = window.setTimeout(() => {
      speakTimer = undefined;
      speakNow(utter);
    }, 80);
  } else {
    // Idle: no cancel was issued — speak NOW (0ms, inside the tap gesture).
    speakNow(utter);
  }
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
    if (!speakSupported()) {
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
      queueSpeak(utter, finish);
    }, 40);
  });
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    safeEngine(() => window.speechSynthesis.cancel());
  }
}
