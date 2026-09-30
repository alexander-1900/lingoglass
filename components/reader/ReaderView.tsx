"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LANG_NAMES, Story, Token } from "@/lib/types";
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
  setMode as persistMode,
  setRate as persistRate,
} from "@/lib/settings";
import { cancelPendingSpeak, ensureVoices, loadVoices, speakAsync, stopSpeaking } from "@/lib/tts";
import { StoryAudio } from "@/lib/story-audio";
import type { StoryAudioSource, WordTap } from "@/lib/story-audio";
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
  const [font, setFontState] = useState<ReadingFont>(DEFAULT_FONT);
  const [fontMenuOpen, setFontMenuOpen] = useState<boolean>(false);
  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [rate, setRateState] = useState<number>(DEFAULT_RATE);
  const [audioSupported, setAudioSupported] = useState(false);
  // Resume affordance: a stored position ahead of the current one offers a
  // "Resume" pill (never auto-jumps — free-scroll UX is preserved).
  const [resumeFrom, setResumeFrom] = useState<number | null>(null);
  // Which engine narrates: "studio" = pre-generated neural MP3 (see
  // lib/story-audio.ts), "native" = the Web Speech sentence loop. Starts
  // "native" so the first client render matches the prerendered HTML; the load
  // effect flips it once the manifest for this story has been resolved.
  const [audioSource, setAudioSource] = useState<StoryAudioSource>("native");
  // Fixture runs (npm run audio:generate -- --fixture) are beeps, not speech —
  // the transport says so instead of passing them off as studio narration.
  const [audioFixture, setAudioFixture] = useState(false);

  const runRef = useRef(0);
  const studioRef = useRef<StoryAudio | null>(null);
  const rateRef = useRef(DEFAULT_RATE);
  const currentIdxRef = useRef(0);
  const fontPickerRef = useRef<HTMLDivElement>(null);
  const fontTriggerRef = useRef<HTMLButtonElement>(null);
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
    const storedFont = getFont();
    setFontState(storedFont);
    applyFont(storedFont); // re-assert the pre-paint value once React owns the page
    setAudioSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    const storedRate = getRate();
    rateRef.current = storedRate;
    setRateState(storedRate);
  }, []);

  // Font menu dismissal: outside pointer-down or Escape closes it, Escape
  // also returns focus to the trigger so keyboard users aren't dropped at
  // the top of the document.
  useEffect(() => {
    if (!fontMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!fontPickerRef.current?.contains(e.target as Node)) setFontMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setFontMenuOpen(false);
      fontTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [fontMenuOpen]);

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
    studioRef.current?.pause();
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
    if (studioRef.current) return; // MP3 playback needs no synthesiser keep-alive
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
    // Studio audio wins whenever it loaded for this story: one continuous MP3
    // seeked per sentence. NOTE: nothing is awaited before playFrom — the
    // element's play() must stay inside the click's user-gesture window (iOS).
    const studio = studioRef.current;
    if (studio) {
      runRef.current += 1; // invalidate any in-flight Web Speech run
      cancelPendingSpeak();
      stopSpeaking(); // a word-tap utterance must not talk over the story
      interactedRef.current = true;
      setPlaying(true);
      setCurrentIdx(start);
      persistProgress(start);
      studio.setRate(rateRef.current);
      studio.playFrom(start);
      return;
    }
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

  // Resolve this story's studio audio after mount (manifest → timing JSON).
  // A null result — no manifest yet, no entry, sentence text edited without
  // regenerating, offline — leaves the Web Speech loop exactly as it was.
  useEffect(() => {
    let cancelled = false;
    let owned: StoryAudio | null = null;
    setAudioSource("native");
    setAudioFixture(false);
    void StoryAudio.load({
      lang: story.lang,
      slug: story.slug,
      texts: story.sentences.map((s) => s.target),
    }).then((studio) => {
      if (!studio) return;
      if (cancelled) {
        studio.dispose(); // StrictMode remount / fast navigation: drop it clean
        return;
      }
      owned = studio;
      studioRef.current = studio;
      studio.setRate(rateRef.current);
      studio.onIndex((idx) => {
        setCurrentIdx(idx);
        persistProgress(idx);
      });
      studio.onEnded(() => {
        setPlaying(false);
        if (interactedRef.current) persistProgress(studio.currentSentence);
      });
      studio.onError(() => {
        // Missing or unstreamable file: retire studio for this story and finish
        // with the built-in voice rather than leaving a silent player.
        studioRef.current = null;
        studio.dispose();
        setAudioSource("native");
        setAudioFixture(false);
        setAudioSupported("speechSynthesis" in window);
        setPlaying(false);
        toast(
          "Studio Audio Unavailable",
          "Switched to the built-in voice for the rest of this story."
        );
        void runFrom(currentIdxRef.current);
      });
      setAudioSource("studio");
      setAudioFixture(studio.fixture);
      // A browser without speechSynthesis can still listen to real audio.
      setAudioSupported(true);
    });
    return () => {
      cancelled = true;
      studioRef.current = null;
      owned?.dispose(); // pauses and aborts any in-flight download
    };
  }, [story, persistProgress, runFrom]);

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

  // Persist + apply live: setFont writes localStorage and re-points
  // <html data-font>, so .target-line/.translation-line repaint immediately.
  const changeFont = useCallback((next: ReadingFont) => {
    setFontState(next);
    setFont(next);
    setFontMenuOpen(false);
    fontTriggerRef.current?.focus(); // the clicked menu item unmounts — don't strand focus
  }, []);

  const changeRate = useCallback((next: number) => {
    rateRef.current = next; // apply to the in-flight playback loop immediately
    studioRef.current?.setRate(next); // and to a playing studio MP3 (pitch-preserved)
    setRateState(next);
    persistRate(next);
  }, []);

  // Tapping a word pauses the story so its audio isn't instantly cancelled.
  const handleWordTap = useCallback(() => {
    if (playing) stop();
  }, [playing, stop]);

  // Studio audio for a tapped word: the MP3 already contains that exact
  // boundary, so the word is spoken by the same neural voice as the story.
  // `false` = nothing to play (no manifest / no boundary covering the tap) and
  // StoryText falls back to the device voice.
  const speakWord = useCallback(
    (tap: WordTap): boolean => {
      const studio = studioRef.current;
      if (!studio) return false;
      stop(); // the story must not talk over the tapped word
      return studio.playWord(tap.sentenceIdx, tap.charStart, tap.charEnd);
    },
    [stop]
  );

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
        <div className="mode-bar-leading" style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
          <div className="mode-bar-heading" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="eyebrow-label">
              {LANG_NAMES[story.lang]} · {story.level.toUpperCase()}
            </span>
            <h3 className="mode-bar-title">{story.title}</h3>
          </div>
        </div>

        <div className="mode-bar-controls">
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

          {/* Reading font: pill + floating menu (both styled in globals.css).
              Each option's label renders in its own face — the list is the
              preview. Menu/trigger outside-click and Escape are handled by
              the dismissal effect above. */}
          <div className="font-picker" ref={fontPickerRef}>
            <button
              ref={fontTriggerRef}
              className={`pill-btn${fontMenuOpen ? " active" : ""}`}
              aria-haspopup="menu"
              aria-expanded={fontMenuOpen}
              aria-label="Reading font"
              title="Reading font"
              onClick={() => setFontMenuOpen((open) => !open)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
                <path d="M12 4v16" />
                <path d="M9 20h6" />
              </svg>
              {FONTS.find((f) => f.id === font)?.label}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {fontMenuOpen && (
              <div className="font-picker-menu glass-panel-heavy" role="menu" aria-label="Reading font">
                {FONTS.map((f) => (
                  <button
                    key={f.id}
                    role="menuitemradio"
                    aria-checked={f.id === font}
                    className={`font-menu-item${f.id === font ? " active" : ""}`}
                    title={f.id === font ? "Current reading font" : `Read stories in ${f.label}`}
                    onClick={() => changeFont(f.id)}
                  >
                    <span className="font-menu-sample" style={{ fontFamily: `var(${f.cssVar})` }}>
                      {f.label}
                    </span>
                    {f.id === font && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <AudioPlayer
        playing={playing}
        currentIdx={currentIdx}
        total={story.sentences.length}
        supported={audioSupported}
        rate={rate}
        speeds={SPEEDS}
        source={audioSource}
        fixture={audioFixture}
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
        onWordSpeak={speakWord}
      />
    </div>
  );
}
