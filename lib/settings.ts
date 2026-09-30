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

const RATE_KEY = "lingoglass:rate";
const MODE_KEY = "lingoglass:parallel-mode";
const ROMAJI_KEY = "lingoglass:show-romaji";

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

/* Reading font (story sentences + translations only — headings/logo keep
   Lobster Two). Each id maps to a next/font/google variable in app/layout.tsx
   and to a --font-reading override in app/globals.css; the file
   tests/font-settings.test.ts keeps all three in sync — plus the pre-paint
   script in layout.tsx, whose id list must match FONTS order below. */
export const FONTS = [
  { id: "lobster-two", label: "Lobster Two", cssVar: "--font-lobster-two" },
  { id: "playfair", label: "Playfair Display", cssVar: "--font-playfair-display" },
  { id: "lora", label: "Lora", cssVar: "--font-lora" },
  { id: "merriweather", label: "Merriweather", cssVar: "--font-merriweather" },
  { id: "garamond", label: "EB Garamond", cssVar: "--font-eb-garamond" },
  { id: "nunito", label: "Nunito", cssVar: "--font-nunito" },
  { id: "caveat", label: "Caveat", cssVar: "--font-caveat" },
] as const;

export type ReadingFont = (typeof FONTS)[number]["id"];

export const DEFAULT_FONT: ReadingFont = "lobster-two";

const FONT_KEY = "lingoglass:font";

/** Current reading font; corrupt/unknown values fall back to the default. */
export function getFont(): ReadingFont {
  const raw = read(FONT_KEY);
  return FONTS.some((f) => f.id === raw) ? (raw as ReadingFont) : DEFAULT_FONT;
}

/** Persist the choice AND re-point <html data-font> so the change is visible
 *  on this page immediately (the pre-paint script in layout.tsx applies the
 *  stored value on the next full load). */
export function setFont(font: ReadingFont): void {
  if (!FONTS.some((f) => f.id === font)) return;
  write(FONT_KEY, font);
  applyFont(font);
}

/** Set <html data-font> without persisting — used to re-assert the stored
 *  choice after mount (defence in depth: the pre-paint script already ran). */
export function applyFont(font: ReadingFont): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-font", font);
}
