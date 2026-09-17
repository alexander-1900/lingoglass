"use client";

const LANG_VOICES: Record<string, string[]> = {
  es: ["es-ES", "es-MX", "es"],
  ru: ["ru-RU", "ru"],
  ja: ["ja-JP", "ja"],
};

let voicesCache: SpeechSynthesisVoice[] = [];

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve([]);
      return;
    }
    let settled = false;
    const done = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      voicesCache = voices;
      resolve(voices);
    };
    // Some platforms never fire onvoiceschanged — never hang forever.
    window.setTimeout(() => done(window.speechSynthesis.getVoices()), 1500);
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      done(existing);
      return;
    }
    window.speechSynthesis.onvoiceschanged = () => {
      done(window.speechSynthesis.getVoices());
    };
  });
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const prefixes = LANG_VOICES[lang] ?? [lang];
  return voicesCache.find((v) =>
    prefixes.some((p) => v.lang.toLowerCase().startsWith(p))
  );
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
  const clean = text.replace(/[\s.,!?;:«»"()—–…¿¡。、、「」『』・！？〈〉《》‹›-]+/g, "");
  if (!clean) return;
  // Chrome drops an utterance queued in the same task as cancel(): cancel
  // now, queue the utterance on the next beat. Coalesce rapid taps so only
  // the latest word sounds.
  window.speechSynthesis.cancel();
  if (speakTimer) window.clearTimeout(speakTimer);
  speakTimer = window.setTimeout(() => {
    speakTimer = undefined;
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(lang);
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang ?? LANG_VOICES[lang]?.[0] ?? lang;
    utter.rate = rate;
    window.speechSynthesis.speak(utter);
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
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(lang);
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang ?? LANG_VOICES[lang]?.[0] ?? lang;
    utter.rate = getRate();
    let done = false;
    let timeout: ReturnType<typeof setTimeout>;
    let kick: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      clearTimeout(kick);
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    // Safety net: some platforms never fire onend for long utterances.
    timeout = setTimeout(finish, 30000);
    // Same Chrome cancel-then-speak race as speak(): defer the kick, and
    // don't start at all if a stop landed in the meantime.
    kick = setTimeout(() => {
      if (signal.cancelled) {
        finish();
        return;
      }
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }, 40);
  });
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
