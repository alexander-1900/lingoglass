"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Story } from "@/lib/types";
import {
  ParallelMode,
  SPEEDS,
  getMode,
  getRate,
  getShowRomaji,
  setMode as persistMode,
  setRate as persistRate,
} from "@/lib/settings";
import { loadVoices, speakAsync, stopSpeaking } from "@/lib/tts";
import AudioPlayer from "./AudioPlayer";
import ParallelToggle from "./ParallelToggle";
import StoryText from "./StoryText";
import { StoryCover } from "../ui/StoryCover";

export default function ReaderView({ story }: { story: Story }) {
  const [mode, setMode] = useState<ParallelMode>(() => getMode());
  const [showRomaji] = useState<boolean>(() => getShowRomaji());
  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [rate, setRateState] = useState<number>(() => getRate());
  const [audioSupported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window
  );

  const runRef = useRef(0);
  const rateRef = useRef(rate);
  rateRef.current = rate;
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
    stopSpeaking();
    setPlaying(false);
  }, []);

  // Stop playback when the reader unmounts (e.g. navigating away).
  useEffect(() => () => stop(), [stop]);

  const runFrom = useCallback(async (start: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
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

  const step = useCallback(
    (delta: number) => seek(currentIdx + delta),
    [seek, currentIdx]
  );

  const changeRate = useCallback((next: number) => {
    setRateState(next);
    persistRate(next);
  }, []);

  const changeMode = useCallback((next: ParallelMode) => {
    setMode(next);
    persistMode(next);
  }, []);

  // Tapping a word pauses the story so its audio isn't instantly cancelled.
  const handleWordTap = useCallback(() => {
    if (playing) stop();
  }, [playing, stop]);

  return (
    <article className={`reader-article lang-${story.lang}`}>
      <StoryCover src={story.image} alt={story.title} lang={story.lang} size="lg" />
      <p className="reader-eyebrow">A graded story</p>
      <h1 className="reader-title">{story.title}</h1>
      {story.titleEn && <p className="reader-sub">{story.titleEn}</p>}

      <div className="reader-controls">
        <AudioPlayer
          playing={playing}
          currentIdx={currentIdx}
          total={story.sentences.length}
          rate={rate}
          speeds={SPEEDS}
          supported={audioSupported}
          onToggle={toggle}
          onSeek={seek}
          onStep={step}
          onRate={changeRate}
        />
        <ParallelToggle mode={mode} onChange={changeMode} />
        <span className="reader-stats">
          {story.minutes} min · {story.sentences.length} sentences
        </span>
      </div>

      <StoryText
        story={story}
        mode={mode}
        showRomaji={showRomaji}
        activeIdx={currentIdx}
        highlight={playing}
        rate={rate}
        onWordTap={handleWordTap}
        onPlayFrom={seek}
      />

      <div className="story-end" aria-hidden="true">
        <span>❦</span>
      </div>
    </article>
  );
}
