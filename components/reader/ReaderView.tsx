"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LANG_NAMES, Story } from "@/lib/types";
import {
  ParallelMode,
  getMode,
  getRate,
  getShowRomaji,
  setMode as persistMode,
} from "@/lib/settings";
import { cancelPendingSpeak, loadVoices, speakAsync, stopSpeaking } from "@/lib/tts";
import AudioPlayer from "./AudioPlayer";
import StoryText from "./StoryText";

const MODE_ICONS: Record<ParallelMode, React.ReactNode> = {
  "side-by-side": (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <rect x="3" y="3" width="7" height="18" rx="1" />
      <rect x="14" y="3" width="7" height="18" rx="1" />
    </svg>
  ),
  "line-by-line": (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  interactive: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

const MODE_LABELS: Record<ParallelMode, string> = {
  "side-by-side": "Side-by-Side",
  "line-by-line": "Line-by-Line",
  interactive: "Interactive Reveal",
};

export default function ReaderView({ story }: { story: Story }) {
  const [mode, setMode] = useState<ParallelMode>(() => getMode());
  const [showRomaji] = useState<boolean>(() => getShowRomaji());
  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [audioSupported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window
  );

  const runRef = useRef(0);
  const rateRef = useRef(getRate());
  const sentencesRef = useRef(story.sentences.map((s) => s.target));
  sentencesRef.current = story.sentences.map((s) => s.target);
  const langRef = useRef(story.lang);
  langRef.current = story.lang;

  // Preload OS voices so the first tap actually speaks.
  useEffect(() => {
    void loadVoices();
  }, []);

  // Keep <html lang> honest for screen readers: story pages declare "en"
  // in the layout, but the content is ES/RU/JA.
  useEffect(() => {
    const prev = document.documentElement.lang;
    document.documentElement.lang = story.lang;
    return () => {
      document.documentElement.lang = prev;
    };
  }, [story.lang]);

  const stop = useCallback(() => {
    runRef.current += 1;
    cancelPendingSpeak();
    stopSpeaking();
    setPlaying(false);
  }, []);

  // Stop playback when the reader unmounts (e.g. navigating away).
  useEffect(() => () => stop(), [stop]);

  // Chrome silently pauses long utterances (~15s, no onend) and iOS stalls
  // chained playback: keep poking the synthesiser while a run is active.
  // resume() on a non-paused engine is a no-op, so this is safe to tick.
  useEffect(() => {
    if (!playing) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const id = window.setInterval(() => {
      try {
        const s = window.speechSynthesis;
        if (s.paused) s.resume();
      } catch {
        /* speech engine unavailable — ignore */
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [playing]);

  const runFrom = useCallback(async (start: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // A word-tap utterance queued just before Listen must not talk over the story.
    cancelPendingSpeak();
    // Refresh the voice list on every run: the mount-time preload may have
    // resolved before the OS exposed voices, leaving the wrong voice picked.
    void loadVoices();
    const runId = runRef.current + 1;
    runRef.current = runId;
    setPlaying(true);
    const total = sentencesRef.current.length;
    for (let i = start; i < total; i += 1) {
      if (runRef.current !== runId) return;
      setCurrentIdx(i);
      await speakAsync(sentencesRef.current[i], langRef.current, () => rateRef.current, {
        get cancelled() {
          return runRef.current !== runId;
        },
      });
      if (runRef.current !== runId) return;
      await new Promise((r) => setTimeout(r, 220));
    }
    if (runRef.current === runId) setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (playing) {
      stop();
    } else {
      const total = sentencesRef.current.length;
      const atEnd = currentIdx >= total - 1;
      void runFrom(atEnd ? 0 : currentIdx);
    }
  }, [playing, stop, runFrom, currentIdx]);

  const seek = useCallback(
    (idx: number) => {
      const total = sentencesRef.current.length;
      const clamped = Math.max(0, Math.min(total - 1, idx));
      if (playing) {
        void runFrom(clamped);
      } else {
        setCurrentIdx(clamped);
      }
    },
    [playing, runFrom]
  );

  const changeMode = useCallback((next: ParallelMode) => {
    setMode(next);
    persistMode(next);
  }, []);

  // Tapping a word pauses the story so its audio isn't instantly cancelled.
  const handleWordTap = useCallback(() => {
    if (playing) stop();
  }, [playing, stop]);

  return (
    <div id="reader-view" className="reader-view active">
      <div className="glass-container mode-selector-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link
            href={`/library/${story.lang}/${story.level}`}
            className="round-btn"
            title="Back to Library"
            aria-label="Back to Library"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </Link>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="eyebrow-label">
              {LANG_NAMES[story.lang]} · {story.level.toUpperCase()}
            </span>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 700 }}>{story.title}</h3>
          </div>
        </div>

        <div className="layout-toggle-group" role="group" aria-label="Reading layout">
          {(Object.keys(MODE_LABELS) as ParallelMode[]).map((m) => (
            <button
              key={m}
              className={`pill-btn${mode === m ? " active" : ""}`}
              data-mode={m}
              title={MODE_LABELS[m]}
              aria-pressed={mode === m}
              onClick={() => changeMode(m)}
            >
              {MODE_ICONS[m]}
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <StoryText
        story={story}
        mode={mode}
        showRomaji={showRomaji}
        activeIdx={currentIdx}
        highlight={playing}
        rate={rateRef.current}
        onWordTap={handleWordTap}
      />

      <AudioPlayer
        playing={playing}
        currentIdx={currentIdx}
        total={story.sentences.length}
        supported={audioSupported}
        onToggle={toggle}
        onSeek={seek}
      />
    </div>
  );
}
