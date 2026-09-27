"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LANG_NAMES, Story, Token } from "@/lib/types";
import {
  DEFAULT_MODE,
  DEFAULT_RATE,
  MODES,
  ParallelMode,
  SPEEDS,
  getMode,
  getRate,
  getShowRomaji,
  setMode as persistMode,
  setRate as persistRate,
} from "@/lib/settings";
import { cancelPendingSpeak, ensureVoices, loadVoices, speakAsync, stopSpeaking } from "@/lib/tts";
import { getProgress, progressKey, setProgress, useProgress } from "@/lib/progress";
import { toast } from "@/lib/juice";
import type { ProgressRecord } from "@/lib/progress";
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

export default function ReaderView({
  story,
  jaTokens,
}: {
  story: Story;
  /** Precomputed Sudachi tokens (Japanese only, from the build step). */
  jaTokens?: Record<number, Token[]>;
}) {
  // Hydration-safe init: this page is statically prerendered, so the first
  // client render must match the server output (constants, NOT localStorage).
  // Persisted preferences are synced after mount in the effect below.
  const [mode, setMode] = useState<ParallelMode>(DEFAULT_MODE);
  const [showRomaji, setShowRomaji] = useState<boolean>(true);
  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [rate, setRateState] = useState<number>(DEFAULT_RATE);
  const [audioSupported, setAudioSupported] = useState(false);
  // Resume affordance: a stored position ahead of the current one offers a
  // "Resume" pill (never auto-jumps — free-scroll UX is preserved).
  const [resumeFrom, setResumeFrom] = useState<number | null>(null);

  const runRef = useRef(0);
  const rateRef = useRef(DEFAULT_RATE);
  const currentIdxRef = useRef(0);
  // Progress only tracks deliberate interaction (playback, seeks): opening
  // a story must never overwrite a saved position with sentence 0.
  const interactedRef = useRef(false);
  // Side effects in the render body break Concurrent/StrictMode guarantees —
  // refs sync after commit instead (bug #4). Initialized from the story so a
  // Play pressed before commit still sees data; the effect below keeps them
  // fresh on navigation (the initial useRef arg alone wouldn't track updates).
  const sentencesRef = useRef<string[]>(story.sentences.map((s) => s.target));
  const langRef = useRef(story.lang);
  useEffect(() => {
    sentencesRef.current = story.sentences.map((s) => s.target);
    langRef.current = story.lang;
  }, [story]);

  const progressMap = useProgress();
  useEffect(() => {
    currentIdxRef.current = currentIdx;
  }, [currentIdx]);

  // Preload OS voices so the first tap actually speaks.
  useEffect(() => {
    void loadVoices();
  }, []);

  // Sync persisted preferences + capability detection after mount (see the
  // useState comment above — reading localStorage during init would break
  // hydration against the statically prerendered HTML).
  useEffect(() => {
    setMode(getMode());
    setShowRomaji(getShowRomaji());
    setAudioSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    const storedRate = getRate();
    rateRef.current = storedRate;
    setRateState(storedRate);
  }, []);

  // <html lang> is owned by AppShell (the story page passes lang) — one
  // place updates it, one place restores it on navigation.

  // One toast per visit: playback writes progress every sentence, so a dead
  // storage would otherwise spam the HUD.
  const progressWarnedRef = useRef(false);

  /** Persist the reading position (local-only).
   *  NOTE: progress tracks deliberate interaction only (playback + seeks);
   *  opening a story never writes, so a saved position can't be clobbered. */
  const persistProgress = useCallback(
    (idx: number) => {
      const total = story.sentences.length;
      if (total <= 0) return;
      const key = progressKey(story.lang, story.level, story.slug);
      const prev = getProgress(key);
      const maxIdx = Math.max(idx, prev?.maxIdx ?? 0);
      const rec: ProgressRecord = {
        lang: story.lang,
        level: story.level,
        slug: story.slug,
        lastIdx: idx,
        maxIdx,
        total,
        completedAt: maxIdx >= total - 1 ? (prev?.completedAt ?? Date.now()) : undefined,
        updatedAt: Date.now(),
      };
      const ok = setProgress(rec);
      if (!ok && !progressWarnedRef.current) {
        progressWarnedRef.current = true;
        toast(
          "Storage Full",
          "Reading position couldn't be saved — your browser storage is unavailable or full."
        );
      }
    },
    [story]
  );

  const stop = useCallback(() => {
    runRef.current += 1;
    cancelPendingSpeak();
    stopSpeaking();
    setPlaying(false);
    if (interactedRef.current) persistProgress(currentIdxRef.current);
  }, [persistProgress]);

  // Stop playback when the reader unmounts (e.g. navigating away).
  useEffect(() => () => stop(), [stop]);

  // Flushing on tab-hide covers mobile navigation that skips unmount.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && interactedRef.current) {
        persistProgress(currentIdxRef.current);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [persistProgress]);

  // Chrome silently pauses long utterances (~15s, no onend) and iOS stalls
  // chained playback: keep poking the synthesiser while a run is active.
  // resume() on a non-paused engine is a no-op — and the wedge this guards
  // against is exactly "engine reports paused, new/queued speech never
  // starts", so tick unconditionally instead of only when paused (that
  // conditional was blind to a silent stop where paused never flips back).
  useEffect(() => {
    if (!playing) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const id = window.setInterval(() => {
      try {
        window.speechSynthesis.resume();
      } catch {
        /* speech engine unavailable — ignore */
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [playing]);

  const runFrom = useCallback(async (start: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // Claim the run BEFORE awaiting: Stop, Pause, seek or navigation during
    // the voice wait (ensureVoices, up to 800ms) bumps runRef, and the check
    // below must observe it — otherwise playback keeps running after unmount
    // ("orphan audio") and the button state lies during the wait.
    const runId = runRef.current + 1;
    runRef.current = runId;
    // A word-tap utterance queued just before Listen must not talk over the story.
    cancelPendingSpeak();
    interactedRef.current = true;
    setPlaying(true); // reflect intent immediately; Stop/Pause work during the wait
    // Refresh the voice list on every run: the mount-time preload may have
    // resolved before the OS exposed voices, leaving the wrong voice picked.
    // Awaiting (capped by ensureVoices) stops sentence #1 from being read
    // with the OS default voice (bug #2).
    await ensureVoices();
    if (runRef.current !== runId) return; // stopped/navigated/seeked during the wait
    const total = sentencesRef.current.length;
    for (let i = start; i < total; i += 1) {
      if (runRef.current !== runId) return;
      setCurrentIdx(i);
      persistProgress(i);
      await speakAsync(sentencesRef.current[i], langRef.current, () => rateRef.current, {
        get cancelled() {
          return runRef.current !== runId;
        },
      });
      if (runRef.current !== runId) return;
      await new Promise((r) => setTimeout(r, 220));
    }
    if (runRef.current === runId) setPlaying(false);
  }, [persistProgress]);

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
      interactedRef.current = true;
      if (playing) {
        void runFrom(clamped); // runFrom persists on its first advance
      } else {
        setCurrentIdx(clamped);
        persistProgress(clamped);
      }
    },
    [playing, runFrom, persistProgress]
  );

  const changeMode = useCallback((next: ParallelMode) => {
    setMode(next);
    persistMode(next);
  }, []);

  const changeRate = useCallback((next: number) => {
    rateRef.current = next; // apply to the in-flight playback loop immediately
    setRateState(next);
    persistRate(next);
  }, []);

  // Tapping a word pauses the story so its audio isn't instantly cancelled.
  const handleWordTap = useCallback(() => {
    if (playing) stop();
  }, [playing, stop]);

  // Resume offer: a stored position ahead of the current one. Recomputed
  // when the progress store updates or playback state changes; never
  // auto-jumps, only offers a pill.
  useEffect(() => {
    const total = story.sentences.length;
    const saved = progressMap[progressKey(story.lang, story.level, story.slug)];
    if (playing) {
      setResumeFrom(null);
      return;
    }
    if (saved && saved.lastIdx > currentIdx && saved.lastIdx < total - 1) {
      setResumeFrom(saved.lastIdx);
    } else {
      setResumeFrom(null);
    }
  }, [progressMap, story, playing, currentIdx]);

  const resume = useCallback(() => {
    if (resumeFrom === null) return;
    setResumeFrom(null);
    void runFrom(resumeFrom);
  }, [resumeFrom, runFrom]);

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
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`pill-btn${mode === m.id ? " active" : ""}`}
              data-mode={m.id}
              title={m.label}
              aria-pressed={mode === m.id}
              onClick={() => changeMode(m.id)}
            >
              {MODE_ICONS[m.id]}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <AudioPlayer
        playing={playing}
        currentIdx={currentIdx}
        total={story.sentences.length}
        supported={audioSupported}
        rate={rate}
        speeds={SPEEDS}
        onToggle={toggle}
        onSeek={seek}
        onRate={changeRate}
      />

      {resumeFrom !== null && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            className="pill-btn active"
            onClick={resume}
            title="Continue where you left off"
            aria-label={`Resume from sentence ${resumeFrom + 1} of ${story.sentences.length}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Resume from sentence {resumeFrom + 1}
          </button>
        </div>
      )}

      <StoryText
        story={story}
        mode={mode}
        showRomaji={showRomaji}
        activeIdx={currentIdx}
        highlight={playing}
        rate={rate}
        jaTokens={jaTokens}
        onWordTap={handleWordTap}
      />
    </div>
  );
}
