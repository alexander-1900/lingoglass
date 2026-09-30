"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MeaningSource } from "@/lib/ja-morphology";

type PopAlign = "center" | "left" | "right";

/** Phone breakpoint: below this the card becomes a bottom sheet. Must stay in
 *  sync with the sheet styles in app/globals.css (base rules vs the
 *  @media (min-width: 768px) block). */
const SHEET_QUERY = "(max-width: 767px)";

interface Props {
  word: string;
  posPill: string;
  lemma?: string;
  translation: string;
  /** "none" → the card admits it has no entry instead of borrowing the
   *  sentence translation as a definition (they look nothing alike to a
   *  learner tapping a word they don't know). */
  meaningSource?: MeaningSource;
  /** Sentence shown under the "In this sentence" label — context, not a gloss. */
  contextTarget?: string;
  contextEn?: string;
  align?: PopAlign;
  vAlign?: "above" | "below";
  /** Controlled visibility: false plays the exit transition before unmount. */
  open: boolean;
  saved: boolean;
  onSave: () => void;
  onSpeak: () => void;
  onClose: () => void;
}

/**
 * Definition card rendered directly ON TOP of the tapped word (absolutely
 * positioned inside the word token, so it scrolls with the text). High
 * z-index + parent isolation keep it above every sibling sentence.
 */
export default function WordPopover({
  word,
  posPill,
  lemma,
  translation,
  meaningSource,
  contextTarget,
  contextEn,
  align = "center",
  vAlign = "above",
  open,
  saved,
  onSave,
  onSpeak,
  onClose,
}: Props) {
  // The CSS transition needs one painted frame in the hidden state before
  // `.active` lands. The timeout is a fallback for background tabs, where
  // rAF never fires (the card would otherwise stay invisible).
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setArmed(true));
    const timer = window.setTimeout(() => setArmed(true), 100);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [open]);
  useEffect(() => {
    if (!open) setArmed(false);
  }, [open]);

  // Phone (<768px): render as a fixed bottom sheet PORTALED TO <body>.
  // The reading ancestors (.reader-workspace.glass-container) carry
  // backdrop-filter, which captures position:fixed — a sheet left inside
  // them would be trapped in the scrolling workspace. Desktop keeps the
  // word-anchored card exactly where it is.
  const [asSheet, setAsSheet] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(SHEET_QUERY).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(SHEET_QUERY);
    const onChange = () => setAsSheet(mq.matches);
    onChange(); // a rotate between render and mount still counts
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Escape dismisses the card (outside clicks are handled by the workspace).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Proper dialog behaviour (#13): move focus into the card when it opens
  // and hand it back to the previously focused element (the tapped word)
  // when it closes — focus used to stay on the token behind the card.
  const cardRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cardRef.current?.focus();
    return () => {
      restoreRef.current?.focus();
      restoreRef.current = null;
    };
    // asSheet: a rotate while open moves the card between DOM roots — focus
    // hands back to the word and then into the card again.
  }, [open, asSheet]);

  const alignClass = align === "center" ? "" : ` align-${align}`;
  const vClass = vAlign === "below" ? " below" : "";
  const visible = open && armed;

  const card = (
    <div
      ref={cardRef}
      tabIndex={-1}
      className={`word-popover glass-panel-heavy in-word${visible ? " active" : ""}${alignClass}${vClass}`}
      role="dialog"
      aria-modal={asSheet}
      aria-label={`Definition of ${word}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="popover-header">
        <span className="popover-target-word">{word}</span>
        <span className="popover-pos">{posPill}</span>
      </span>
      {lemma ? <span className="popover-lemma">{lemma}</span> : null}
      {meaningSource === "none" ? (
        <span className="popover-none">No dictionary entry yet</span>
      ) : (
        <span className="popover-translation">{translation}</span>
      )}
      {contextTarget || contextEn ? (
        <span className="popover-context">
          <span className="popover-context-label">In this sentence</span>
          {contextTarget ? <span className="popover-context-target">{contextTarget}</span> : null}
          {contextEn ? <span className="popover-context-en">{contextEn}</span> : null}
        </span>
      ) : null}
      <span className="popover-actions">
        <button className="popover-btn btn-pronounce" onClick={onSpeak} aria-label={`Hear ${word}`} title="Speak native pronunciation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
          Speak
        </button>
        <button
          className={`popover-btn btn-save-vocab${saved ? " saved" : ""}`}
          onClick={onSave}
          aria-pressed={saved}
          aria-label={saved ? `${word} saved` : `Bookmark ${word}`}
          title={saved ? "Saved to vocabulary queue" : "Bookmark to vocabulary queue"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          {saved ? "Saved" : "Bookmark"}
        </button>
      </span>
      <span className="popover-arrow" aria-hidden="true" />
    </div>
  );

  // Sheet mode: portal card + dimmer past the backdrop-filtered reader
  // containers to <body>, so the fixed positioning is truly viewport-level
  // (see globals.css). Tapping the scrim dismisses — the touch equivalent of
  // the desktop's click-outside-to-close.
  if (asSheet) {
    return createPortal(
      <>
        <div
          className={`word-popover-scrim${visible ? " active" : ""}`}
          onClick={onClose}
          aria-hidden="true"
        />
        {card}
      </>,
      document.body
    );
  }
  return card;
}
