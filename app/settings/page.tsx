"use client";

import Link from "next/link";
import { useState } from "react";
import AppShell from "@/components/shell/AppShell";
import {
  DEFAULT_MODE,
  DEFAULT_RATE,
  DEFAULT_VOICE,
  MODES,
  ParallelMode,
  SPEEDS,
  VOICE_GENDERS,
  VoiceGender,
  getMode,
  getRate,
  getShowRomaji,
  getVoiceGender,
  setMode,
  setRate,
  setShowRomaji,
  setVoiceGender,
} from "@/lib/settings";

export default function SettingsPage() {
  const [rate, setRateState] = useState<number>(() => getRate());
  const [mode, setModeState] = useState<ParallelMode>(() => getMode());
  const [romaji, setRomajiState] = useState<boolean>(() => getShowRomaji());
  const [voice, setVoiceState] = useState<VoiceGender>(() => getVoiceGender());

  return (
    <AppShell>
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
          <h2>Voice</h2>
          <p>Whose voice reads the stories aloud. The closest installed match is used.</p>
          <div className="layout-toggle-group" role="group" aria-label="Voice">
            {VOICE_GENDERS.map((v) => (
              <button
                key={v.id}
                className={`pill-btn${voice === v.id ? " active" : ""}`}
                aria-pressed={voice === v.id}
                title={v.hint}
                onClick={() => {
                  setVoiceState(v.id);
                  setVoiceGender(v.id);
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
          <p className="setting-note">
            Current: {VOICE_GENDERS.find((v) => v.id === voice)?.hint}
            {voice === DEFAULT_VOICE ? " (default)" : ""}
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
    </AppShell>
  );
}
