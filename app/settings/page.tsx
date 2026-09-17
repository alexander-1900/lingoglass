"use client";

import Link from "next/link";
import { useState } from "react";
import { IconArrowLeft } from "@/components/ui/icons";
import {
  DEFAULT_MODE,
  DEFAULT_RATE,
  MODES,
  ParallelMode,
  SPEEDS,
  getMode,
  getRate,
  getShowRomaji,
  setMode,
  setRate,
  setShowRomaji,
} from "@/lib/settings";

export default function SettingsPage() {
  const [rate, setRateState] = useState<number>(() => getRate());
  const [mode, setModeState] = useState<ParallelMode>(() => getMode());
  const [romaji, setRomajiState] = useState<boolean>(() => getShowRomaji());

  return (
    <>
      <div className="shell">
        <header className="topbar reveal">
          <Link href="/" className="icon-btn" aria-label="Back to library">
            <IconArrowLeft />
          </Link>
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">❖</span>Settings
          </span>
          <span style={{ width: 48 }} aria-hidden="true" />
        </header>

        <section className="page-head">
          <div className="corners reveal d1" aria-hidden="true"><span>Index · 04</span><span>On this device</span></div>
          <p className="kicker reveal d1">Reading preferences</p>
          <h1 className="reveal d2">Read it your way</h1>
          <p className="lede reveal d3">
            These apply to every story, on this device. Audio uses your
            operating system&apos;s voices for Russian, Spanish and Japanese.
          </p>
        </section>

        <div className="settings-list">
          <section className="setting-card reveal d1" aria-labelledby="setting-speed">
            <h2 id="setting-speed">Voice speed</h2>
            <p>How fast stories and words are read aloud.</p>
            <div className="player-speeds" role="group" aria-labelledby="setting-speed">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  className={`player-speed ${s === rate ? "active" : ""}`}
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
            <p className="setting-current">
              Current: {rate}×{rate === DEFAULT_RATE ? " (default)" : ""}
            </p>
          </section>

          <section className="setting-card reveal d2" aria-labelledby="setting-text">
            <h2 id="setting-text">Text display</h2>
            <p>What you see under each sentence.</p>
            <div className="mode-toggle" role="group" aria-labelledby="setting-text">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  className={`mode-btn ${mode === m.id ? "active" : ""}`}
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
            <p className="setting-current">
              Current: {MODES.find((m) => m.id === mode)?.hint}
              {mode === DEFAULT_MODE ? " (default)" : ""}
            </p>
          </section>

          <section className="setting-card reveal d3" aria-labelledby="setting-romaji">
            <h2 id="setting-romaji">Romaji</h2>
            <p>Show romanized readings above Japanese words.</p>
            <div className="mode-toggle" role="group" aria-labelledby="setting-romaji">
              <button
                className={`mode-btn ${romaji ? "active" : ""}`}
                aria-pressed={romaji}
                onClick={() => {
                  setRomajiState(true);
                  setShowRomaji(true);
                }}
              >
                On
              </button>
              <button
                className={`mode-btn ${!romaji ? "active" : ""}`}
                aria-pressed={!romaji}
                onClick={() => {
                  setRomajiState(false);
                  setShowRomaji(false);
                }}
              >
                Off
              </button>
            </div>
            <p className="setting-current">Current: {romaji ? "On (default)" : "Off"}</p>
          </section>
        </div>
      </div>
    </>
  );
}
