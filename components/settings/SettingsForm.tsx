"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DEFAULT_FONT,
  DEFAULT_MODE,
  DEFAULT_RATE,
  FONTS,
  MODES,
  ParallelMode,
  ReadingFont,
  SPEEDS,
  applyFont,
  getFont,
  getMode,
  getRate,
  getShowRomaji,
  setFont,
  setMode,
  setRate,
  setShowRomaji,
} from "@/lib/settings";

export default function SettingsForm() {
  // Hydration-safe init: this page is statically prerendered, so the first
  // client render must match the server output (constants, NOT localStorage).
  // Persisted preferences are synced after mount in the effect below — the
  // same pattern ReaderView uses (the old lazy-initializer version read
  // localStorage during first render and mismatched the prerendered HTML).
  const [rate, setRateState] = useState<number>(DEFAULT_RATE);
  const [mode, setModeState] = useState<ParallelMode>(DEFAULT_MODE);
  const [romaji, setRomajiState] = useState<boolean>(true);
  const [font, setFontState] = useState<ReadingFont>(DEFAULT_FONT);

  useEffect(() => {
    setRateState(getRate());
    setModeState(getMode());
    setRomajiState(getShowRomaji());
    const storedFont = getFont();
    setFontState(storedFont);
    applyFont(storedFont); // re-assert the pre-paint value once React owns the page
  }, []);

  return (
    <section id="stories-platform" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20, minHeight: 0, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Link href="/" className="round-btn" title="Back to library" aria-label="Back to library">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </Link>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="eyebrow-label">Reading preferences</span>
          <h3 style={{ fontSize: "1.3rem", fontWeight: 700 }}>Read it your way</h3>
        </div>
      </div>

      <div className="glass-container setting-block">
        <h2>Voice speed</h2>
        <p>How fast stories and words are read aloud.</p>
        <div className="layout-toggle-group" role="group" aria-label="Voice speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`pill-btn${s === rate ? " active" : ""}`}
              aria-pressed={s === rate}
              onClick={() => {
                setRateState(s);
                setRate(s);
              }}
            >
              {s}×
            </button>
          ))}
        </div>
        <p className="setting-note">
          Current: {rate}×{rate === DEFAULT_RATE ? " (default)" : ""}
        </p>
      </div>

      <div className="glass-container setting-block">
        <h2>Reading layout</h2>
        <p>How the target text and English translation sit together.</p>
        <div className="layout-toggle-group" role="group" aria-label="Reading layout">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`pill-btn${mode === m.id ? " active" : ""}`}
              aria-pressed={mode === m.id}
              title={m.hint}
              onClick={() => {
                setModeState(m.id);
                setMode(m.id);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="setting-note">
          Current: {MODES.find((m) => m.id === mode)?.hint}
          {mode === DEFAULT_MODE ? " (default)" : ""}
        </p>
      </div>

      <div className="glass-container setting-block">
        <h2>Reading font</h2>
        <p>
          Typeface for story sentences and their translations — the same choice as the font button
          in the reader bar. Headings keep the brand font.
        </p>
        <div className="layout-toggle-group" role="group" aria-label="Reading font">
          {FONTS.map((f) => (
            <button
              key={f.id}
              className={`pill-btn${font === f.id ? " active" : ""}`}
              aria-pressed={font === f.id}
              title={`Read stories in ${f.label}`}
              onClick={() => {
                setFontState(f.id);
                setFont(f.id);
              }}
            >
              {/* the label renders in its own face — the pill is the preview */}
              <span style={{ fontFamily: `var(${f.cssVar})` }}>{f.label}</span>
            </button>
          ))}
        </div>
        <p className="setting-note">
          Current: {FONTS.find((f) => f.id === font)?.label}
          {font === DEFAULT_FONT ? " (default)" : ""}
        </p>
      </div>

      <div className="glass-container setting-block">
        <h2>Romaji</h2>
        <p>Show romanized readings above Japanese words.</p>
        <div className="layout-toggle-group" role="group" aria-label="Romaji">
          <button
            className={`pill-btn${romaji ? " active" : ""}`}
            aria-pressed={romaji}
            onClick={() => {
              setRomajiState(true);
              setShowRomaji(true);
            }}
          >
            On
          </button>
          <button
            className={`pill-btn${!romaji ? " active" : ""}`}
            aria-pressed={!romaji}
            onClick={() => {
              setRomajiState(false);
              setShowRomaji(false);
            }}
          >
            Off
          </button>
        </div>
        <p className="setting-note">Current: {romaji ? "On (default)" : "Off"}</p>
      </div>
    </section>
  );
}