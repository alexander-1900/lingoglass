"use client";

export type ParallelMode = "side-by-side" | "line-by-line" | "interactive";

export const MODES: { id: ParallelMode; label: string; hint: string }[] = [
  { id: "side-by-side", label: "Side-by-Side", hint: "Target and English in parallel columns" },
  { id: "line-by-line", label: "Line-by-Line", hint: "Translation under each sentence" },
  { id: "interactive", label: "Interactive Reveal", hint: "Tap a sentence to reveal its translation" },
];

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];
export const DEFAULT_RATE = 1;
export const DEFAULT_MODE: ParallelMode = "side-by-side";

export type VoiceGender = "auto" | "female" | "male";
export const VOICE_GENDERS: { id: VoiceGender; label: string; hint: string }[] = [
  { id: "female", label: "Woman", hint: "Prefer a feminine voice" },
  { id: "male", label: "Man", hint: "Prefer a masculine voice" },
  { id: "auto", label: "Auto", hint: "Whatever voice the device picks first" },
];
export const DEFAULT_VOICE: VoiceGender = "auto";

const RATE_KEY = "lingoglass:rate";
const MODE_KEY = "lingoglass:parallel-mode";
const ROMAJI_KEY = "lingoglass:show-romaji";
const VOICE_KEY = "lingoglass:voice-gender";

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode etc. — settings just don't persist */
  }
}

export function getRate(): number {
  const raw = Number(read(RATE_KEY));
  return SPEEDS.includes(raw) ? raw : DEFAULT_RATE;
}

export function setRate(rate: number): void {
  if (SPEEDS.includes(rate)) write(RATE_KEY, String(rate));
}

export function getMode(): ParallelMode {
  const raw = read(MODE_KEY);
  return raw === "side-by-side" || raw === "line-by-line" || raw === "interactive" ? raw : DEFAULT_MODE;
}

export function setMode(mode: ParallelMode): void {
  write(MODE_KEY, mode);
}

export function getShowRomaji(): boolean {
  return read(ROMAJI_KEY) !== "off";
}

export function setShowRomaji(show: boolean): void {
  write(ROMAJI_KEY, show ? "on" : "off");
}

export function getVoiceGender(): VoiceGender {
  const raw = read(VOICE_KEY);
  return raw === "female" || raw === "male" || raw === "auto" ? raw : DEFAULT_VOICE;
}

export function setVoiceGender(gender: VoiceGender): void {
  write(VOICE_KEY, gender);
}
